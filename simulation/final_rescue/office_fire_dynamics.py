"""Bounded visual fire modulation inside the existing owned scenario process.

Only Light and ParticleEmitter messages are sent. No pose, collision, robot,
door or navigation commands are available here. Static scene remains usable if
the optional visual transport is unavailable.
"""
from pathlib import Path
import json, math, os, threading, time
import xml.etree.ElementTree as ET

ROOT=Path('/data-ssd/zhongchengkai/agnes')

def pulse(t, phase=0.0):
    """Continuous, non-synchronous turbulence factor in [0.64, 1.0]."""
    return .82+.10*math.sin(2.2*t+phase)+.06*math.sin(4.7*t+1.3*phase)+.02*math.sin(9.1*t+.7*phase)

def load_config(world_path):
    world_path=Path(world_path).resolve()
    if not world_path.is_relative_to(ROOT):raise ValueError('OFFICE_WORLD_OUTSIDE_WORKSPACE')
    path=world_path.with_name('office-fire-runtime-config.json')
    if not path.exists():return None
    config=json.loads(path.read_text())
    world=ET.parse(world_path).getroot().find('world')
    # Scene preparation assigns a fresh world name after map compilation.
    config['world_name']=world.get('name')
    # Only names belonging to declared visual effects are accepted.
    for light in config.get('lights',[]):
        if not light['name'].startswith('office_fire_') or world.find("light[@name='"+light['name']+"']") is None:
            raise ValueError('UNKNOWN_OFFICE_LIGHT')
        if not all(math.isfinite(v) for v in light['color']+light['position']):raise ValueError('INVALID_OFFICE_LIGHT')
    for item in config.get('emitters',[]):
        model=world.find("model[@name='"+item['model']+"']")
        if not item['model'].startswith('office_fire_') or model is None:raise ValueError('UNKNOWN_OFFICE_EMITTER_MODEL')
        e=model.find("link[@name='"+item['link']+"']/particle_emitter[@name='"+item['emitter']+"']")
        if e is None or e.findtext('topic')!=item['topic'] or not item['topic'].startswith('/office_fire/'):
            raise ValueError('UNKNOWN_OFFICE_EMITTER')
        try:
            limits={key:float(item[key]) for key in ('rate','min_velocity','max_velocity')}
        except (KeyError,TypeError,ValueError):
            raise ValueError('INVALID_OFFICE_EMITTER_LIMIT') from None
        if not all(math.isfinite(value) and value>=0 for value in limits.values()):
            raise ValueError('INVALID_OFFICE_EMITTER_LIMIT')
        if limits['min_velocity']>limits['max_velocity']:
            raise ValueError('INVALID_OFFICE_EMITTER_VELOCITY_RANGE')
        size=item.get('particle_size')
        if not isinstance(size,(list,tuple)) or len(size)!=3:
            raise ValueError('INVALID_OFFICE_PARTICLE_SIZE')
        try:
            size=[float(value) for value in size]
        except (TypeError,ValueError):
            raise ValueError('INVALID_OFFICE_PARTICLE_SIZE') from None
        if not all(math.isfinite(value) and value>=0 for value in size):
            raise ValueError('INVALID_OFFICE_PARTICLE_SIZE')
        try:
            static_size=[float(value) for value in (e.findtext('particle_size') or '').split()]
            static_rate=float(e.findtext('rate'))
            static_velocity=float(e.findtext('max_velocity'))
        except (TypeError,ValueError):
            raise ValueError('INVALID_OFFICE_STATIC_EMITTER_LIMIT') from None
        if len(static_size)!=3 or not all(math.isfinite(value) and value>=0
                                          for value in [*static_size,static_rate,static_velocity]):
            raise ValueError('INVALID_OFFICE_STATIC_EMITTER_LIMIT')
        if (limits['max_velocity']>static_velocity+1e-6 or limits['rate']>static_rate+1e-6
                or any(value>ceiling+1e-6 for value,ceiling in zip(size,static_size))):
            raise ValueError('OFFICE_EMITTER_EXCEEDS_STATIC_BUDGET')
        # Keep exactly the validated numeric values for later protobuf updates.
        item.update(limits,particle_size=size)
    return config

class OfficeFireDynamics:
    def __init__(self, world_path):
        self.path=Path(world_path).resolve()
        self.config=None
        self.stop_event=threading.Event()
        self.clock={'time':None,'seen':0.0}
        self.thread=None
        self.state={'visual_only':True,'world_name':None,
                    'light_updates':0,'particle_updates':0,'failed_updates':0}
        try:
            self.config=load_config(self.path)
        except Exception as error:
            self.state.update(status='VISUAL_MODULATION_FAILED',error=type(error).__name__+':'+str(error))
            self.save()
            return
        if self.config:
            self.state['world_name']=self.config['world_name']
            self.thread=threading.Thread(target=self.run,name='office-fire-visuals',daemon=True)
            self.thread.start()

    def update_clock(self, sim_time):
        # Clock arrives through the existing ROS executor. A gz Python subscriber
        # plus synchronous Node.request can deadlock its transport callback/GIL.
        if math.isfinite(sim_time):
            self.clock={'time':float(sim_time),'seen':time.monotonic()}

    def save(self):
        # Optional rendering status must never bring down navigation/physics.
        try:
            if not self.path.is_relative_to(ROOT):return
            target=self.path.with_name('office-fire-runtime.json')
            temp=target.with_suffix('.tmp')
            temp.write_text(json.dumps({**self.state,'updated_at':time.time()},indent=2)+'\n')
            temp.replace(target)
        except Exception as error:
            self.state['status_write_error']=type(error).__name__

    def run(self):
        try:
            from gz.transport13 import Node
            from gz.msgs10.light_pb2 import Light
            from gz.msgs10.boolean_pb2 import Boolean
            from gz.msgs10.particle_emitter_pb2 import ParticleEmitter
            node=Node()
            world=self.config['world_name']
            pubs=[node.advertise(item['topic'],ParticleEmitter) for item in self.config['emitters']]
            self.state['status']='WAITING_FOR_SIM_CLOCK';self.save()
            last_t=None;last_save=0;tick=0;started=time.monotonic();delay=.125;failed_cycles=0
            while not self.stop_event.wait(delay):
                cycle_start=time.monotonic();delay=.125
                clock=self.clock
                t=clock['time']
                if t is None or time.monotonic()-clock['seen']>2 or t==last_t:continue
                last_t=t;tick+=1
                light_values={};successful_lights=0
                for item in self.config['lights']:
                    f=pulse(t,item.get('phase',0))
                    msg=Light(name=item['name'],type=Light.POINT)
                    msg.pose.position.x,msg.pose.position.y,msg.pose.position.z=item['position']
                    msg.pose.orientation.w=1
                    msg.diffuse.r,msg.diffuse.g,msg.diffuse.b=item['color']
                    msg.diffuse.a=1
                    msg.specular.r,msg.specular.g,msg.specular.b=[v*.22 for v in item['color']]
                    msg.specular.a=1
                    msg.attenuation_constant=.55;msg.attenuation_linear=.20;msg.attenuation_quadratic=.055
                    msg.range=item['range'];msg.cast_shadows=False
                    msg.intensity=.72+.56*f
                    timeout_ms=1000 if self.state['light_updates']==0 else 120
                    ok,res=node.request(f'/world/{world}/light_config/blocking',msg,Light,Boolean,timeout_ms)
                    if ok and res.data:
                        self.state['light_updates']+=1;successful_lights+=1
                    else:self.state['failed_updates']+=1
                    light_values[item['name']]=msg.intensity
                # Only rate and velocity change. Ogre2 SetParticleSize rebuilds
                # the entire system, truncating every flame's natural lifetime.
                if tick%2==0:
                    for item,pub in zip(self.config['emitters'],pubs):
                        f=pulse(t,item.get('phase',0))
                        msg=ParticleEmitter(name=item['emitter'])
                        msg.rate.data=item['rate']*f
                        msg.min_velocity.data=item['min_velocity']*(.8+.2*f)
                        msg.max_velocity.data=item['max_velocity']*(.8+.2*f)
                        if pub.publish(msg):self.state['particle_updates']+=1
                        else:self.state['failed_updates']+=1
                failed_cycles=failed_cycles+1 if successful_lights<len(self.config['lights']) else 0
                self.state.update(status='RUNNING' if not failed_cycles else 'DEGRADED_LIGHT_TRANSPORT',
                                  sim_time=t,light_intensities=light_values,
                                  emitter_count=len(pubs),light_count=len(self.config['lights']),
                                  particle_geometry_updates=False,
                                  cycle_count=tick,observed_cycle_hz=tick/max(.001,time.monotonic()-started))
                delay=max(.015,.125-(time.monotonic()-cycle_start))
                if failed_cycles>=2:delay=max(delay,1.0)
                if time.monotonic()-last_save>2:
                    self.save();last_save=time.monotonic()
        except Exception as error:
            self.state.update(status='VISUAL_MODULATION_FAILED',error=type(error).__name__+':'+str(error))
            self.save()

    def close(self):
        self.stop_event.set()
        if self.thread:self.thread.join(timeout=2)
