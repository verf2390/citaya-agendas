"""One real private tenant preview. Uses synthetic media; never connects to Citaya."""
import json,sys,uuid
from pathlib import Path
R=Path(__file__).resolve().parents[1];sys.path[:0]=[str(R/'backend'),str(R/'scripts')]
from studio import Studio,Actor
from worker import run_one
from production import read_json,write_json
root=R/'storage'/('smoke-'+uuid.uuid4().hex[:12]);s=Studio(root)
a=Actor(str(uuid.uuid4()),str(uuid.uuid4()));b=Actor(str(uuid.uuid4()),str(uuid.uuid4()))
c=read_json(R/'configs/examples/local-business.json');c.pop('media',None);c['brand'].pop('logo',None)
p=s.create_project(a,c,'Prueba privada de negocio')
logo=s.upload(a,p,R/'inputs/test-fixtures/logo.png');picture=s.upload(a,p,R/'inputs/test-fixtures/business.png')
c['brand']['logo']='asset:'+logo;c['media']={'images':['asset:'+picture]};s.update_project(a,p,c)
s.validate_project(a,p);job=s.enqueue(a,p,'preview','smoke-preview-v1');assert s.enqueue(a,p,'preview','smoke-preview-v1')==job
run_one(s,'smoke-render-1');j=s.row('video_jobs',a,job)
if j['status']!='completed':raise RuntimeError('Queue preview failed: '+str(j['error_code']))
outputs=[dict(r) for r in s.db.execute('SELECT * FROM video_outputs WHERE tenant_id=? AND job_id=?',(a.tenant_id,job))]
assert len(outputs)==6
video=next(o for o in outputs if o['output_type']=='video');assert s.download_path(a,video['id']).is_file()
try:s.download_path(b,video['id']);raise AssertionError('Tenant B read A output')
except Exception as e:assert getattr(e,'code',None)=='NOT_FOUND'
s.approve_final(a,job) # Exercise approval only; DO NOT enqueue/render a final in development.
report={'status':'pass','tenantId':a.tenant_id,'projectId':p,'jobId':job,'storage':str(root.relative_to(R)),'video':str(s.download_path(a,video['id']).relative_to(R)),'outputs':len(outputs),'usage':s.usage(a),'crossTenantDownload':'blocked','finalApproval':'recorded; no final requested'}
write_json(R/'tests/queue-smoke-result.json',report);print(json.dumps(report,indent=2));s.close()
