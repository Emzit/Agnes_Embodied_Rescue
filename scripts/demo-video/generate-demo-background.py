#!/usr/bin/env python3
"""Original procedural ambient bed for this demo; no external audio or model."""
import argparse,array,datetime,hashlib,json,math,wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def inside(value):
 p=Path(value);p=(ROOT/p).resolve() if not p.is_absolute() else p.resolve()
 if p!=ROOT and ROOT not in p.parents:raise ValueError('Outside workspace')
 return p
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--out',default='artifacts/demo-video-20261013/assets/narration/original-ambient-300.wav')
 ap.add_argument('--duration',type=float,default=300)
 a=ap.parse_args()
 if not 10<=a.duration<=600:raise ValueError('Duration out of range')
 p=inside(a.out);p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists():raise ValueError('Output exists')
 rate=48000;block=48000;size=int(round(a.duration*rate))
 chords=[[45,48,52,59],[41,45,48,55],[48,52,55,62],[43,47,50,57]]
 freqs=[[440*2**((n-69)/12) for n in c] for c in chords]
 chord_sec=12;crossfade=2.0
 with wave.open(str(p),'wb') as out:
  out.setparams((2,2,rate,0,'NONE','not compressed'))
  for base in range(0,size,block):
   values=array.array('h')
   for i in range(base,min(base+block,size)):
    t=i/rate;idx=int(t/chord_sec)%len(chords);prev=(idx-1)%len(chords)
    blend=min(1.,(t%chord_sec)/crossfade);blend=blend*blend*(3-2*blend)
    def sample(index,channel):
     fs=freqs[index];s=0.
     for j,f in enumerate(fs):
      phase=2*math.pi*f*t+channel*.015*(j+1)
      s+=math.sin(phase)*(.16+.024*math.sin(2*math.pi*.037*t+j))+.025*math.sin(phase*2+.2)
     return s
    edge=min(1.,t/3,max(0.,(a.duration-t)/4))
    for channel in (0,1):
     value=(sample(prev,channel)*(1-blend)+sample(idx,channel)*blend)*edge
     values.append(int(max(-.98,min(.98,value))*32767))
   if __import__('sys').byteorder!='little':values.byteswap()
   out.writeframesraw(values.tobytes())
 meta={'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'kind':'original_procedural_audio','file':str(p.relative_to(ROOT)),
  'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'duration_sec':size/rate,'sample_rate':rate,'channels':2,
  'description':'Original slow ambient formant-free sine/harmonic pad, four generated MIDI chord sets with 2 s smooth crossfade and 3/4 s edge fades. No external sound recording, composition sample, model or cloud service.',
  'algorithm_file':str(Path(__file__).resolve().relative_to(ROOT)),
  'algorithm_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
  'parameters':{'chords_midi':chords,'chord_duration_sec':chord_sec,'crossfade_sec':crossfade,'suggested_mix_gain_db':-28},
  'external_audio_sources':[],'model_calls':0}
 provenance=p.with_suffix('.provenance.json');provenance.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'file':str(p),'provenance_file':str(provenance),'sha256':meta['sha256'],'duration_sec':meta['duration_sec']},ensure_ascii=False))
if __name__=='__main__':main()
