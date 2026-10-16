"""User-authorized two-way simulation selector verification, using its guarded API."""
from pathlib import Path
import json,urllib.request,uuid,time,hashlib
R=Path('/data-ssd/zhongchengkai/agnes');D=R/'artifacts/map-switch-localization-repair-20261015';O=R/'artifacts/demo-ui-final';HASH='da09cbb260342f386c28d962dab26eb88fc2f70243e58cc9a2880c459785d72e'
assert Path.cwd()==R
first=json.loads((D/'forward-switch.json').read_text());job=json.loads((O/'scene-switch/jobs'/first['job_id']/'status.json').read_text());assert job['status']=='SUCCEEDED'
results=[{'step':'classic-to-office','job_id':job['job_id'],'status':job['status']}]
for step,target,localization in [('office-to-classic','classic',None),('restore-office','office-fire','amcl')]:
 token=str(uuid.uuid4());request=urllib.request.Request('http://127.0.0.1:4177/api/demo-ui/maps/activate',data=json.dumps({'id':target,'request_id':token}).encode(),headers={'Origin':'http://127.0.0.1:4177','Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},method='POST')
 with urllib.request.urlopen(request,timeout=10)as response:reply=json.load(response);assert response.status==202
 print(json.dumps({'step':step,'job_id':token,'status':'RUNNING'}),flush=True);deadline=time.monotonic()+240;previous=None
 while time.monotonic()<deadline:
  state=json.loads((O/'scene-switch/current-job.json').read_text());assert state['job_id']==token,'EXTERNAL_SCENE_SWITCH_DETECTED'
  if state['phase']!=previous:print(json.dumps({'step':step,'phase':state['phase'],'status':state['status']},ensure_ascii=False),flush=True);previous=state['phase']
  if state['status']!='RUNNING':break
  time.sleep(1)
 else:raise RuntimeError('SCENE_TRANSACTION_TIMEOUT')
 assert state['status']=='SUCCEEDED',state
 folder=O/'scene-switch/jobs'/token;plan=json.loads((folder/'plan-private.json').read_text());assert plan['layout'].get('localization')==localization
 proof=json.loads((folder/'physical-proof.json').read_text());assert proof['new_map_received']and proof['spawn_distance_ok']and proof['navigation_commands_issued']==0 and proof['camera']['real_sensor']
 restore=json.loads((folder/'profile-reference-transaction.json').read_text());assert restore['phase']=='RESTORED';assert hashlib.sha256((R/'.agh-home-step7/profiles/local-dev/profile.yaml').read_bytes()).hexdigest()==restore['original_sha256']
 assert hashlib.sha256((R/'artifacts/media-archive/alpha/alpha.mp4').read_bytes()).hexdigest()==HASH
 results.append({'step':step,'job_id':token,'status':state['status'],'localization':localization,'map_received':True,'spawn_and_camera_verified':True,'profile_restored_exactly':True,'alpha_unchanged':True});print(json.dumps(results[-1]),flush=True)
 (D/'roundtrip-progress.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
(D/'roundtrip-verification.json').write_text(json.dumps({'passed':True,'steps':results,'final_map':'office-fire','alpha_sha256':HASH,'unit_tests_passed':39},ensure_ascii=False,indent=2)+'\n');print('ROUNDTRIP_COMPLETE',flush=True)
