#!/usr/bin/env python3
"""Project-local offline eSpeak NG formant narration; no model or cloud request."""
import argparse,datetime,hashlib,json,math,os,subprocess,wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/'artifacts/demo-video-20261013/assets'
PREFIX=ASSETS/'espeak-ng/install'
BIN=ROOT/'runtime/ros2-jazzy/.pixi/envs/default/bin'
def inside(value,exists=False):
 p=Path(value);p=(ROOT/p).resolve() if not p.is_absolute() else p.resolve()
 if p!=ROOT and ROOT not in p.parents:raise ValueError('Path outside workspace')
 if exists and not p.is_file():raise ValueError('Missing input')
 return p
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def duration(p):
 with wave.open(str(p)) as f:return f.getnframes()/f.getframerate()
def command(args,env=None):
 subprocess.run([str(x) for x in args],env=env,check=True,capture_output=True,text=True)
def main():
 a=argparse.ArgumentParser()
 a.add_argument('--plan',default='artifacts/demo-video-20261013/narration-plan-draft.json')
 a.add_argument('--out',default='artifacts/demo-video-20261013/assets/narration/clips-draft')
 a.add_argument('--speed',type=int,default=205)
 a.add_argument('--voice',choices=('cmn-latn-pinyin',),default='cmn-latn-pinyin',help='Mandarin pinyin rules; avoids legacy cmn English fallback for dictionary-generated pinyin')
 a.add_argument('--pitch',type=int,default=50)
 a.add_argument('--amplitude',type=int,default=100)
 args=a.parse_args()
 if not 130<=args.speed<=260:raise ValueError('Unsupported speaking speed')
 if not 0<=args.pitch<=99 or not 1<=args.amplitude<=200:raise ValueError('Unsupported pitch or amplitude')
 plan=inside(args.plan,True);out=inside(args.out);out.mkdir(parents=True,exist_ok=True)
 data=json.loads(plan.read_text());segments=data['segments']
 env=dict(os.environ);env['LD_LIBRARY_PATH']=str(PREFIX/'usr/lib/x86_64-linux-gnu')+(':'+env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
 software=ASSETS/'espeak-ng/software-provenance.json'
 records=[];clips=[]
 for s in segments:
  name=str(s['id'])
  if not name.replace('_','').isalnum():raise ValueError('Invalid segment id')
  text=s.get('speech_text',s['text'])
  txt=out/(name+'.txt');raw=out/(name+'-raw.wav');wav=out/(name+'.wav')
  if any(p.exists() for p in [txt,raw,wav]):raise ValueError('Output already exists: '+name)
  txt.write_text(text)
  command([PREFIX/'usr/bin/espeak-ng','--path='+str(PREFIX/'usr/lib/x86_64-linux-gnu'),'-v',args.voice,'-s',args.speed,'-p',args.pitch,'-a',args.amplitude,'-b',1,'-w',raw,'-f',txt],env)
  command([BIN/'ffmpeg','-nostdin','-hide_banner','-loglevel','error','-n','-i',raw,
   '-af','highpass=f=80,lowpass=f=7200,loudnorm=I=-18:TP=-2:LRA=7',
   '-ar',48000,'-ac',1,'-c:a','pcm_s16le',wav])
  secs=duration(wav)
  rec={'id':name,'path':str(wav.relative_to(ROOT)),'sha256':digest(wav),'duration_sec':secs,
   'text':s['text'],'speech_text':text,'text_sha256':digest(txt),'raw_path':str(raw.relative_to(ROOT)),
   'raw_sha256':digest(raw),'raw_duration_sec':duration(raw),'voice':args.voice,'speed_wpm':args.speed,
   'pitch':args.pitch,'amplitude':args.amplitude,'processing':'80 Hz highpass, 7200 Hz lowpass, loudnorm -18 LUFS / -2 dBTP / 7 LRA; 48 kHz mono PCM16',
   'target_start_draft':s['start'],'target_end_draft':s['end'],'fits_draft_slot':secs<=s['end']-s['start']-.3,
   'license_notice':str((PREFIX/'usr/share/doc/espeak-ng/copyright').relative_to(ROOT))}
  records.append(rec)
  clips.append({'id':name,'start':s['start'],'file':str(wav.relative_to(ROOT)),'sha256':rec['sha256'],'gain_db':0,'text':s['text'],
   'source':{'kind':'offline_formant_tts','description':'Original Chinese project narration synthesized offline with eSpeak NG 1.51 '+args.voice+' rules/formant voice; no model or cloud API.',
    'provenance_file':str((out/'audio-provenance.json').relative_to(ROOT))}})
  print(json.dumps({'id':name,'duration_sec':round(secs,3),'draft_slot_sec':s['end']-s['start'],'fits':rec['fits_draft_slot']},ensure_ascii=False),flush=True)
 provenance={'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'offline_formant_tts',
  'status':'DRAFT_CUE_TIMING_REQUIRES_NEW_RECORDING_ALIGNMENT','input_plan':str(plan.relative_to(ROOT)),
  'input_plan_sha256':digest(plan),'software_provenance_file':str(software.relative_to(ROOT)),
  'software_provenance_sha256':digest(software),'model_calls':0,'cloud_calls':0,
  'human_voice_recording':False,'voice':args.voice,'intelligibility_review':'Human listening review required; PCM/phoneme checks do not prove understandable or natural narration.','software_license':'GPL-3.0-or-later with bundled notices and file-specific exceptions; see official extracted package notices',
  'records':records}
 (out/'audio-provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n')
 cues={'version':1,'clips':clips}
 (out/'narration-cues-draft.json').write_text(json.dumps(cues,ensure_ascii=False,indent=2)+'\n')
 print('NARRATION_CUES '+str(out/'narration-cues-draft.json'))
if __name__=='__main__':main()
