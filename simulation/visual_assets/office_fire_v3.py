"""Fuel-attached office fire, ceiling rollover and stratified smoke.

Visual effects only: no collisions, model calls or claimed combustion physics.
All coordinates refer to the existing office plan and workstation footprints.
"""
from pathlib import Path
import json,math
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/"simulation/visual_assets/office_fire_v3_textures"
LEGACY_ASSETS=ROOT/"simulation/visual_assets/office_fire_textures"
CEILING_SOURCES=[(-1.80,3.32,-1.46),(-1.72,2.60,-1.42),(-1.57,1.88,-1.34),
                 (4.08,-.46,2.98),(3.30,-.38,2.90),
                 (-4.40,.75,.39),(-3.70,1.05,.39),(-3.00,1.35,.39)]
BURN_ZONES=[
    {"source":"front_records","surface":"front_wall","bounds":{"min_x":-2.7,"max_x":-.75,"min_y":3.64,"max_y":3.8,"min_z":.78,"max_z":2.8}},
    {"source":"right_cable","surface":"right_wall","bounds":{"min_x":4.32,"max_x":4.5,"min_y":-1.04,"max_y":-.04,"min_z":.85,"max_z":2.8}},
    {"source":"workstation","model":"office_workstation_6","center":[-4.4,.7,0],"parts":["drawer_cabinet","white_desk","green_divider","chair_back"],"bounds":{"min_x":-5.30,"max_x":-3.50,"min_y":-.42,"max_y":1.13,"min_z":.02,"max_z":1.20}},
    {"source":"rollover","surface":"ceiling","centers":[[x,y,2.8] for x,y,_ in CEILING_SOURCES],"radius_m":.9}
]

def child(parent,tag,text,**attrs):
    e=ET.SubElement(parent,tag,attrs);e.text=str(text);return e

def model(world,name):
    m=ET.SubElement(world,"model",name=name);child(m,"static","true")
    return m,ET.SubElement(m,"link",name="effects")

def box(link,name,xyz,size,rgb,rotation=(0,0,0)):
    v=ET.SubElement(link,"visual",name=name)
    child(v,"pose"," ".join(map(str,(*xyz,*rotation))))
    child(v,"cast_shadows","false")
    child(ET.SubElement(ET.SubElement(v,"geometry"),"box"),"size"," ".join(map(str,size)))
    mat=ET.SubElement(v,"material")
    for tag in ("ambient","diffuse"):child(mat,tag," ".join(map(str,(*rgb,1))))
    child(mat,"specular",".015 .015 .015 1")
    metal=ET.SubElement(ET.SubElement(mat,"pbr"),"metal")
    child(metal,"metalness","0");child(metal,"roughness",".92")
    return v

def _fuel_objects(world):
    # Replace visible cabinet skin, not its exact existing collider. Papers and
    # casing stay within workstation_6's already occupied .35 x .55 footprint.
    desk=world.find("model[@name='office_workstation_6']/link")
    if desk is not None:
        for v in list(desk.findall("visual")):
            if v.get("name")=="drawer_cabinet" or v.get("name","").startswith(("drawer_line_","drawer_handle_")):desk.remove(v)
    _,cab=model(world,"office_fire_cabinet_papers")
    cx,cy=-3.88,.71
    for side in (-1,1):
        box(cab,"cabinet_side_"+str(side),(cx+side*.165,cy,.32),(.02,.55,.63),(.22,.21,.18))
    box(cab,"cabinet_back",(cx,cy+.265,.32),(.31,.02,.63),(.20,.19,.17))
    for z in (.015,.315,.625):
        box(cab,"cabinet_shelf_"+str(z),(cx,cy,z),(.35,.55,.02),(.29,.28,.25))
    for row,z in enumerate((.07,.11,.15,.36,.40,.44)):
        box(cab,"paper_stack_"+str(row),(cx+(.012 if row%2 else -.012),cy-.045,z),(.27,.36,.026),(.46+.035*(row%3),.43,.34),(.015*(row%3),0,.04*(-1)**row))
        box(cab,"charred_paper_edge_"+str(row),(cx,cy-.227,z+.013),(.25,.012,.013),(.13,.10,.065))
    # A few curled/torn sheets rise above the paper drawers, beneath the desk.
    for i in range(3):
        box(cab,"curled_sheet_"+str(i),(cx-.075+i*.07,cy-.17,.51+i*.025),(.09,.17,.005),(.39,.31,.18),(.20+i*.16,.14*i,.10*i))
    _,records=model(world,"office_fire_wall_records")
    box(records,"metal_file_back",(-1.8,3.705,1.20),(.82,.035,.62),(.34,.33,.30))
    box(records,"file_tray_lip",(-1.8,3.66,.99),(.82,.055,.13),(.31,.28,.23))
    for i in range(5):
        box(records,"paper_folder_"+str(i),(-2.10+i*.145,3.662,1.27+.025*(i%3)),(.125,.012,.46),(.55-.055*i,.47-.045*i,.30-.025*i),(0,.04*(i-2),0))
    _,cable=model(world,"office_fire_wall_cables")
    for i in range(3):
        box(cable,"cable_"+str(i),(4.405,-.63+i*.11,1.84),(.021,.023,1.84),(.12,.105,.085))
        box(cable,"ceiling_cable_"+str(i),(4.11,-.63+i*.11,2.73),(.62,.023,.021),(.16,.13,.09))
    box(cable,"cable_junction_box",(4.395,-.52,1.04),(.055,.36,.20),(.25,.23,.18))
    return ["office_fire_cabinet_papers","office_fire_wall_records","office_fire_wall_cables"]

def _emit(link,name,xyz,size,rate,lifetime,vmin,vmax,growth,texture,life,
          pitch=-math.pi/2,yaw=0,spread=(.025,.15,.07)):
    assets=ASSETS if (ASSETS/texture).is_file() else LEGACY_ASSETS
    life_assets=ASSETS if (ASSETS/life).is_file() else LEGACY_ASSETS
    for path in (assets/texture,life_assets/life):
        if not path.is_file():raise FileNotFoundError(path)
    e=ET.SubElement(link,"particle_emitter",name=name,type="box")
    values={"pose":" ".join(map(str,(*xyz,0,pitch,yaw))),"emitting":"true","duration":0,
            "size":" ".join(map(str,spread)),"particle_size":" ".join(map(str,size)),
            "rate":rate,"lifetime":lifetime,"min_velocity":vmin,"max_velocity":vmax,
            "scale_rate":growth,"particle_scatter_ratio":0}
    for key,value in values.items():child(e,key,value)
    mat=ET.SubElement(e,"material")
    for tag,value in [("ambient","1 1 1 1"),("diffuse","1 1 1 1"),("specular","0 0 0 1"),("lighting","false"),("double_sided","true")]:child(mat,tag,value)
    if not texture.startswith("smoke"):child(mat,"emissive","1 1 1 1")
    metal=ET.SubElement(ET.SubElement(mat,"pbr"),"metal")
    child(metal,"metalness",0);child(metal,"roughness",.96);child(metal,"albedo_map",str(assets/texture))
    child(e,"color_range_image",str(life_assets/life))
    return e

def apply_fire_effects(world,out):
    out=Path(out).resolve()
    if not out.is_relative_to(ROOT):raise ValueError("OFFICE_FIRE_OUTPUT_OUTSIDE_WORKSPACE")
    out.mkdir(parents=True,exist_ok=True)
    for n in list(world):
        if n.tag=="model" and n.get("name","").startswith("office_fire_"):world.remove(n)
    if not any(p.get("name")=="gz::sim::systems::ParticleEmitter" for p in world.findall("plugin")):
        ET.SubElement(world,"plugin",filename="gz-sim-particle-emitter-system",name="gz::sim::systems::ParticleEmitter")
    fuel_models=_fuel_objects(world)
    dynamic=[];emitters=[]
    def source(name):
        return model(world,"office_fire_"+name)
    def add(m,l,name,xyz,size,rate,life,vmin,vmax,growth,texture="flame_a.png",ramp="life_fast.png",
            pitch=-math.pi/2,yaw=0,spread=(.025,.15,.07),dynamic_source=None,phase=0):
        e=_emit(l,name,xyz,size,rate,life,vmin,vmax,growth,texture,ramp,pitch,yaw,spread)
        topic="/office_fire/"+m.get("name")+"/"+name+"/cmd"
        child(e,"topic",topic)
        row={"model":m.get("name"),"link":l.get("name"),"emitter":name,"topic":topic,
             "rate":rate,"lifetime":life,"min_velocity":vmin,"max_velocity":vmax,
             "particle_size":list(size),"position":list(xyz),"spread":list(spread),
             "pitch":pitch,"yaw":yaw,"growth":growth,"phase":phase,"source":dynamic_source or "passive"}
        emitters.append(row)
        if dynamic_source:dynamic.append({**row,"rate_min_factor":.64,"rate_max_factor":1,"particle_size_mode":"static"})
        return e
    m,l=source("front_records")
    for i,(x,z,w,h,rate,life,vmax) in enumerate([(-2.02,1.40,.88,.86,24,.78,.66),(-1.59,1.56,.94,.91,21,.75,.57),(-1.80,1.99,.84,.54,17,.60,.43)]):
        add(m,l,"paper_tongue_"+str(i),(x,3.635-.02*(i%2),z),(w,h,w),rate,life,vmax*.58,vmax,.02,
            texture="flame_"+chr(97+i)+".png",ramp="life_fast.png" if i%2==0 else "life_long.png",
            yaw=math.pi/2,spread=(.025,.42,.09),dynamic_source="front_records" if i!=1 else None,phase=.2)
    m,l=source("right_cable")
    for i,z in enumerate((1.25,1.67,2.07)):
        add(m,l,"cable_tongue_"+str(i),(4.32-.02*(i%2),-.51,z),(.57,.70 if i<2 else .40,.57),
            18 if i<2 else 15,.69 if i<2 else .51,.20,.52 if i<2 else .32,.012,
            texture="flame_"+chr(97+(i+1)%3)+".png",spread=(.018,.16,.045),
            dynamic_source="right_cable" if i!=1 else None,phase=2.4)
    m,l=source("workstation")
    fires=[
        ("drawer_paper",(-3.88,.44,.49),(.38,.60,.38),24,.65,.56,"flame_core.png"),
        ("desk_front",(-4.62,.52,1.15),(.75,.88,.65),23,.78,.65,"flame_a.png"),
        ("desk_side",(-4.22,.74,1.14),(.67,.77,.57),20,.70,.64,"flame_b.png"),
        ("divider",(-4.53,1.015,1.10),(.92,.80,.60),19,.76,.58,"flame_c.png"),
        ("chair_back",(-4.40,-.235,.79),(.44,.68,.40),16,.68,.50,"flame_b.png"),
        ("rising_plume",(-4.38,.75,1.65),(.70,.65,.62),18,.64,.44,"flame_c.png")]
    for i,(name,xyz,size,rate,life,vmax,texture) in enumerate(fires):
        add(m,l,name,xyz,size,rate,life,vmax*.51,vmax,.024,texture,
            "life_long.png" if i%2 else "life_fast.png",spread=(.028,.19,.16),
            dynamic_source="workstation" if i in (0,1,3,4) else None,phase=4.1)
    # Several rising smoke plumes tie fuel to the upper layer. These stay
    # beside the objects rather than filling the robot's 1.35m-height sightline.
    for i,(x,y,z) in enumerate([(-1.8,3.55,2.05),(4.18,-.50,2.10),(-4.4,.75,1.94)]):
        m,l=source("plume_"+str(i))
        add(m,l,"buoyant_smoke",(x,y,z),(.64,.39,.64),3,1.25,.07,.16,.025,
            "smoke_wisp.png","smoke_life.png",spread=(.02,.24,.14))
        add(m,l,"embers",(x,y,z-.5),(.017,.033,.017),1.4,.68,.32,.66,0,
            "spark.png","spark_life.png",spread=(.01,.18,.04))
    for i,(x,y,yaw) in enumerate(CEILING_SOURCES):
        m,l=source("ceiling_roll_"+str(i))
        name="front_records" if i<3 else "right_cable" if i<5 else "workstation"
        phase=.2 if i<3 else 2.4 if i<5 else 4.1
        add(m,l,"rollover",(x,y,2.485),(1.18+.12*(i%3),.38,.38),13,.82,.23,.47,.012,
            "ceiling_roll_"+("a" if i%2 else "b")+".png","life_long.png",
            pitch=0,yaw=yaw,spread=(.08,.30,.024),dynamic_source=name,phase=phase)
        # Sparse independent curls give depth without a second continuous strip.
        if i%2==0:
            add(m,l,"curl",(x+.10*math.cos(yaw),y+.10*math.sin(yaw),2.39),
                (.70,.31,.31),5,.55,.34,.60,.012,"ceiling_roll_a.png","life_fast.png",
                pitch=0,yaw=yaw+.29,spread=(.05,.19,.018))
    smoke_centers=[(-1.8,3.2),(-1.65,2.35),(-1.45,1.5),(3.95,-.48),(3.1,-.32),
                   (-4.45,.68),(-3.6,1.04),(-2.8,1.5),(-2.2,2.25)]
    for i,(x,y) in enumerate(smoke_centers):
        m,l=source("smoke_layer_"+str(i))
        yaw=-1.45 if i<3 else 2.9 if i<5 else .45
        add(m,l,"upper_smoke",(x,y,2.48),(1.75+.16*(i%3),.22,1.5),2.4,3.8,.025,.070,.008,
            "smoke_upper_"+("a" if i%2 else "b")+".png","smoke_life.png",
            pitch=0,yaw=yaw,spread=(.18,.48,.024))
        if i%2==0:
            add(m,l,"lower_wisp",(x+.17,y-.12,2.312),(1.28,.24,1.2),1.5,2.8,.045,.10,.01,
                "smoke_wisp.png","smoke_life.png",pitch=0,yaw=yaw+.32,spread=(.15,.32,.022))
    lights=[
        {"name":"office_fire_light_records","position":[-1.8,3.15,1.80],"color":[.95,.38,.095],"range":5.8,"phase":.2,"source":"front_records"},
        {"name":"office_fire_light_cable","position":[3.94,-.51,1.88],"color":[.82,.30,.052],"range":4.8,"phase":2.4,"source":"right_cable"},
        {"name":"office_fire_light_workstation","position":[-4.30,.42,1.40],"color":[1,.43,.12],"range":5.8,"phase":4.1,"source":"workstation"},
        {"name":"office_fire_light_ceiling_front","position":[-1.6,2.25,2.43],"color":[.70,.31,.09],"range":5.8,"phase":.2,"source":"front_records"},
        {"name":"office_fire_light_ceiling_desk","position":[-3.2,1.45,2.43],"color":[.67,.29,.078],"range":5.5,"phase":4.1,"source":"workstation"}]
    budget=sum(e["rate"]*e["lifetime"] for e in emitters)
    metadata={"schema":"agnes.office-fire-effects.v3","visual_fire_only":True,"physical_fire_solver":False,
              "source":"Project-authored procedural fuel, flame and smoke assets; no model calls or copied third-party pixels",
              "burn_zones":BURN_ZONES,"fuel_models":fuel_models,"fire_ceiling_sources":len(CEILING_SOURCES),
              "emitters":emitters,"dynamic_emitters":dynamic,"lights":lights,
              "particle_emitters":len(emitters),"approx_steady_live_particles":round(budget),
              "max_live_particle_budget":round(budget,2),"dynamic_rate_max_factor":1,
              "smoke_layer_envelope_m":[2.15,2.65],"adds_collision":False,
              "ground_fire_piles":0,"scorch_overlay_meshes":0,"particle_scatter_ratio":0}
    if budget>550:raise ValueError("OFFICE_FIRE_PARTICLE_BUDGET_EXCEEDED")
    if len(dynamic)>20:raise ValueError("OFFICE_FIRE_DYNAMIC_EMITTER_BUDGET_EXCEEDED")
    (out/"office-fire-effects.json").write_text(json.dumps(metadata,indent=2)+"\n")
    return metadata
