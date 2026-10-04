import copy,json,os,sqlite3,sys,tempfile,unittest,uuid
from pathlib import Path
R=Path(__file__).resolve().parents[1];sys.path[:0]=[str(R/'scripts'),str(R/'backend')]
from production import validate,read_json,ConfigError,digest,schema_validate,parse_srt
from studio import Studio,Actor,fingerprint
from compose import compile_composition
class ConfigTests(unittest.TestCase):
 def config(self,name='veterinary'):return read_json(R/('configs/veterinary.json' if name=='veterinary' else f'configs/examples/{name}.json'))
 def bad(self,c,code):
  with self.assertRaises(ConfigError) as e:validate(c)
  self.assertEqual(e.exception.code,code)
 def test_internal_live(self):
  c,r,_=validate(self.config());self.assertTrue(r['valid']);self.assertTrue(all(x['status']=='live' for x in r['capabilities']))
 def test_external_logo_images(self):
  c,r,_=validate(self.config('local-business'));self.assertEqual(c['product'],'custom-client-video');self.assertEqual(len(r['mediaSha256']),2)
 def test_website(self):self.assertTrue(validate(self.config('website-services'))[1]['valid'])
 def test_creator_voiceover(self):
  c,r,x=validate(self.config('creator-led'));self.assertEqual([s['start'] for s in x['speech']],[0,3]);self.assertEqual(len(x['cues']),2)
 def test_creator_intro_has_no_face_overlay_and_hook_moves_to_first_scene(self):
  c,r,x=validate(self.config('creator-led'))
  c['hook']='Reserva online sin mensajes'
  with tempfile.TemporaryDirectory() as d:
   comp,_=compile_composition(c,x,Path(d),'preview');html=(comp/'index.html').read_text()
   self.assertNotIn('id="creator-title"',html)
   self.assertIn('<h2 class="headline">Reserva online sin mensajes</h2>',html)
 def test_vtt(self):self.assertEqual(len(parse_srt(R/'inputs/test-fixtures/captions.vtt',10)),1)
 def test_missing_optional_creator(self):
  c=self.config();c['creator']={'introVideo':'inputs/missing.mp4'};self.bad(c,'MEDIA_NOT_FOUND')
  c['creator']['introVideo']=None;self.assertTrue(validate(c)[1]['valid'])
 def test_malformed_ai(self):
  c=self.config();c['shell']='rm -rf';self.bad(c,'SCHEMA_VALIDATION')
  c=self.config();c['audio']={'music':'yes'};self.bad(c,'SCHEMA_VALIDATION')
 def test_planned_blocked(self):
  c=self.config();c['capabilities']=['clinical_records'];self.bad(c,'CAPABILITY_NOT_COMMERCIAL')
 def test_roadmap_visible(self):
  c,r,x=validate(self.config('roadmap'))
  with tempfile.TemporaryDirectory() as d:
   comp,_=compile_composition(c,x,Path(d),'preview');s=(comp/'index.html').read_text();self.assertIn('HOJA DE RUTA',s);self.assertIn('Planificado · No disponible',s)
 def test_gate_cannot_be_invented(self):
  c=self.config();c['capabilities']=['factura_33'];self.bad(c,'CAPABILITY_GATE_REQUIRED')
 def test_path_traversal(self):
  c=self.config();c['creator']={'introVideo':'inputs/../../data.mp4'};self.bad(c,'UNSAFE_MEDIA_PATH')
 def test_no_invented_client_imagery(self):
  c=self.config('local-business');c['scenes']=[{'capability':'provided_business_content','mode':'desktop','duration':5}];self.bad(c,'PROVIDED_MEDIA_REQUIRED')
 def test_ducking_required(self):
  c=self.config('creator-led');c['audio']={'music':True,'duckMusicDuringVoice':False};self.bad(c,'VOICE_DUCKING_REQUIRED')
 def test_final_contract(self):
  import subprocess
  p=subprocess.run([sys.executable,str(R/'scripts/generate-video.py'),'--config',str(R/'configs/veterinary.json'),'--mode','final'],capture_output=True,text=True)
  self.assertEqual(p.returncode,2);self.assertIn('FINAL_APPROVAL_REQUIRED',p.stderr)
 def test_offer_and_before_after_configs(self):
  for name in ['offer','before-after']:self.assertTrue(validate(self.config(name))[1]['valid'])
 def test_catalog_integrity(self):
  caps=read_json(R/'catalog/capabilities.json')['capabilities'];self.assertEqual(len(caps),len({c['id'] for c in caps}))
  products=read_json(R/'catalog/products.json')['products'];templates={x['id'] for x in read_json(R/'catalog/templates.json')['templates']}
  for p in products:self.assertTrue(set(p['allowedTemplates'])<=templates)
  for c in caps:self.assertIn(c['status'],['live','demo','in_progress','planned'])
 def test_minute_vtt_timestamps(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'c.vtt';p.write_text('WEBVTT\n\ncue-name\n00:00.000 --> 00:01.000\nPrueba\n');self.assertEqual(parse_srt(p,10)[0]['end'],1)
 def test_brand_url_cannot_expose_credentials(self):
  c=self.config('local-business');c['brand']['website']='https://demo:private@example.invalid';self.bad(c,'UNSAFE_PUBLIC_URL')
 def test_schema_is_valid(self):
  from jsonschema import Draft202012Validator
  Draft202012Validator.check_schema(read_json(R/'schemas/video-config.schema.json'))
 def test_visual_style_presets_compile_with_reel_safe_contract(self):
  for preset in ['minimal','dynamic','premium']:
   with self.subTest(preset=preset):
    raw=self.config();raw['stylePreset']=preset;c,r,x=validate(raw)
    self.assertEqual(r['stylePreset'],preset)
    with tempfile.TemporaryDirectory() as d:
     comp,_=compile_composition(c,x,Path(d),'preview');html=(comp/'index.html').read_text()
     self.assertIn('preset-'+preset,html);self.assertIn('data-style-preset="'+preset+'"',html);self.assertIn('--reel-safe-bottom:250px',html)
     self.assertIn('.stage .progress{display:none}',html)
  css=(R/'templates/presets.css').read_text()
  self.assertIn('.preset-dynamic #brand-chrome .product-name{display:none}',css)
  self.assertIn('top:1280px',css)
  raw=self.config();raw['stylePreset']='invented';self.bad(raw,'SCHEMA_VALIDATION')
 def test_barber_uses_niche_aware_demo_without_affecting_other_niches(self):
  barber,_,bx=validate(self.config('barber'))
  with tempfile.TemporaryDirectory() as d:
   comp,_=compile_composition(barber,bx,Path(d),'preview');html=(comp/'index.html').read_text()
   for value in ['Barbería Demo','Corte','Barba','Corte + barba']:
    self.assertIn(value,html)
  full=self.config('barber')
  full['capabilities']=['online_booking','professional_selection','date_time_availability']
  full['timing']={'intro':2.8,'demo':14.4,'outro':2.8}
  full['scenes']=[
   {'capability':'online_booking','mode':'service','duration':4.8},
   {'capability':'professional_selection','mode':'professional','duration':4.8},
   {'capability':'date_time_availability','mode':'date','duration':4.8},
  ]
  full,_,fx=validate(full)
  with tempfile.TemporaryDirectory() as d:
   comp,_=compile_composition(full,fx,Path(d),'preview');html=(comp/'index.html').read_text()
   for value in ['Barbero A','Barbero B','Elige fecha y hora','Mar 06','11:30']:
    self.assertIn(value,html)
  psychology,_,px=validate(self.config('psychology'))
  with tempfile.TemporaryDirectory() as d:
   comp,_=compile_composition(psychology,px,Path(d),'preview');html=(comp/'index.html').read_text()
   self.assertNotIn('Barbería Demo',html)
   self.assertIn('assets/ui/service.png',html)
class TenantTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.s=Studio(self.temp.name);self.a=Actor(str(uuid.uuid4()),str(uuid.uuid4()));self.b=Actor(str(uuid.uuid4()),str(uuid.uuid4()))
  self.cfg={'product':'custom-client-video','niche':'local-business','brand':{'businessName':'Negocio Demo'},'content':{'hook':'Conoce nuestro trabajo.','cta':'Conversemos'},'mediaApproved':True,'timing':{'intro':2,'demo':4,'outro':2}}
  self.pa=self.s.create_project(self.a,self.cfg);self.pb=self.s.create_project(self.b,self.cfg)
 def tearDown(self):self.s.close();self.temp.cleanup()
 def error(self,code,fn):
  with self.assertRaises(ConfigError) as e:fn()
  self.assertEqual(e.exception.code,code)
 def test_cross_tenant_asset(self):
  asset=self.s.upload(self.b,self.pb,R/'inputs/test-fixtures/logo.png');c=copy.deepcopy(self.cfg);c['brand']['logo']='asset:'+asset;self.s.update_project(self.a,self.pa,c)
  self.error('NOT_FOUND',lambda:self.s.enqueue(self.a,self.pa,'preview','1'))
 def test_cross_project_asset(self):
  other=self.s.create_project(self.a,self.cfg);asset=self.s.upload(self.a,other,R/'inputs/test-fixtures/logo.png');c=copy.deepcopy(self.cfg);c['brand']['logo']='asset:'+asset;self.s.update_project(self.a,self.pa,c)
  self.error('ASSET_PROJECT_MISMATCH',lambda:self.s.enqueue(self.a,self.pa,'preview','1'))
 def test_arbitrary_path_blocked(self):
  c=copy.deepcopy(self.cfg);c['brand']['logo']='inputs/test-fixtures/logo.png';self.s.update_project(self.a,self.pa,c);self.error('TENANT_ASSET_REFERENCE',lambda:self.s.enqueue(self.a,self.pa,'preview','1'))
 def complete_preview(self):
  id=self.s.enqueue(self.a,self.pa,'preview','preview-1');job=self.s.claim('test-node');self.assertEqual(job['id'],id)
  f=Path(self.temp.name)/'test.txt';f.write_text('Synthetic output for contract test')
  self.s.finish(job,{'config':f},{'wallSeconds':1,'cpuSeconds':.5,'width':720,'height':1280,'durationMs':8000});return id,job,f
 def test_output_tenant_isolation(self):
  id,_,_=self.complete_preview();out=self.s.db.execute('SELECT id FROM video_outputs WHERE job_id=?',(id,)).fetchone()[0]
  self.assertTrue(self.s.download_path(self.a,out).is_file());self.error('NOT_FOUND',lambda:self.s.download_path(self.b,out))
 def test_job_tenant_isolation(self):
  id=self.s.enqueue(self.a,self.pa,'preview','1');self.error('NOT_FOUND',lambda:self.s.cancel(self.b,id))
 def test_final_requires_preview_and_approval(self):
  self.error('FINAL_APPROVAL_REQUIRED',lambda:self.s.enqueue(self.a,self.pa,'final','f1'))
  id,_,_=self.complete_preview();self.error('FINAL_APPROVAL_REQUIRED',lambda:self.s.enqueue(self.a,self.pa,'final','f1'))
  self.s.approve_final(self.a,id);f=self.s.enqueue(self.a,self.pa,'final','f1');self.assertEqual(f,self.s.enqueue(self.a,self.pa,'final','f1'));self.error('PROJECT_BUSY',lambda:self.s.enqueue(self.a,self.pa,'final','f2'));self.s.cancel(self.a,f);self.error('FINAL_APPROVAL_REQUIRED',lambda:self.s.enqueue(self.a,self.pa,'final','f2'))
 def test_changed_config_revokes_approval(self):
  id,_,_=self.complete_preview();self.s.approve_final(self.a,id);c=copy.deepcopy(self.cfg);c['content']['cta']='Escríbenos';self.s.update_project(self.a,self.pa,c);self.error('FINAL_APPROVAL_REQUIRED',lambda:self.s.enqueue(self.a,self.pa,'final','f'))
 def test_metering_idempotent(self):
  id,job,f=self.complete_preview();self.assertFalse(self.s.finish(job,{'config':f},{'wallSeconds':1}));self.s.record_ai(self.a,'request-1','qwen-local','local',100,30,project_id=self.pa,job_id=id,model='Qwen3-4B-GGUF:Q4_K_M',latency_seconds=1.234);self.s.record_ai(self.a,'request-1','qwen-local','local',100,30,project_id=self.pa,job_id=id,model='Qwen3-4B-GGUF:Q4_K_M',latency_seconds=1.234)
  u=self.s.usage(self.a)[0];self.assertEqual(u['previews_generated'],1);self.assertEqual(u['ai_input_tokens'],100);self.assertEqual(u['render_seconds'],1);self.assertEqual(u['cpu_seconds'],.5)
  events=[dict(r) for r in self.s.db.execute('SELECT event_type,provider,provider_mode,metrics_json FROM video_usage_events WHERE tenant_id=? ORDER BY created_at',(self.a.tenant_id,))]
  ai=next(x for x in events if x['event_type']=='ai');am=json.loads(ai['metrics_json']);self.assertEqual(am['projectId'],self.pa);self.assertEqual(am['jobId'],id);self.assertEqual(am['model'],'Qwen3-4B-GGUF:Q4_K_M');self.assertEqual(am['ai_total_tokens'],130);self.assertEqual(am['latencySeconds'],1.234)
  complete=next(x for x in events if x['event_type']=='render_complete');cm=json.loads(complete['metrics_json']);self.assertEqual(cm['projectId'],self.pa);self.assertEqual(cm['jobId'],id);self.assertGreater(cm['output_bytes'],0)
 def test_project_usage_report_and_accumulated_summary(self):
  jid,job,f=self.complete_preview()
  self.s.record_ai(self.a,'report-ai','qwen-local','local',120,40,project_id=self.pa,job_id=jid,model='Qwen3-4B-GGUF:Q4_K_M',latency_seconds=2.5)
  report=self.s.project_usage_report(self.a,self.pa)
  self.assertEqual(report['projectId'],self.pa);self.assertEqual(report['ai']['requests'],1);self.assertEqual(report['ai']['totalTokens'],160);self.assertEqual(report['ai']['latencySeconds'],2.5)
  self.assertEqual(report['render']['previews'],1);self.assertEqual(report['render']['finals'],0);self.assertEqual(report['render']['wallSeconds'],1);self.assertEqual(report['render']['cpuSeconds'],.5)
  self.assertGreater(report['bytes']['output'],0);self.assertEqual(len(report['jobs']),1);self.assertGreater(report['jobs'][0]['outputBytes'],0)
  summary=self.s.usage_summary(self.a);self.assertEqual(summary['totals']['previews_generated'],1);self.assertEqual(summary['totals']['ai_total_tokens'],160);self.assertGreater(summary['totals']['current_storage_bytes'],0)
  self.error('NOT_FOUND',lambda:self.s.project_usage_report(self.b,self.pa))
 def test_cancelled_attempt_cannot_publish(self):
  id=self.s.enqueue(self.a,self.pa,'preview','1');job=self.s.claim('node');self.s.cancel(self.a,id);self.assertFalse(self.s.finish(job,{}, {'wallSeconds':2}));self.assertEqual(self.s.usage(self.a)[0]['previews_generated'],0)
 def test_fenced_retry(self):
  id=self.s.enqueue(self.a,self.pa,'preview','1');old=self.s.claim('node');self.s.finish(old,{}, {'wallSeconds':1},'TEST_FAILURE');self.s.retry(self.a,id);new=self.s.claim('other-node');self.assertNotEqual(old['lease_token'],new['lease_token']);self.assertFalse(self.s.finish(old,{},{}))
 def test_validated_artifacts_use_opaque_asset_ids(self):
  id=self.s.upload(self.a,self.pa,R/'inputs/test-fixtures/logo.png');c=copy.deepcopy(self.cfg);c['brand']['logo']='asset:'+id
  normalized,report=self.s.validated(self.a,self.pa,c,'preview')
  self.assertEqual(normalized['brand']['logo'],'asset:'+id);self.assertIn('asset:'+id,report['mediaSha256']);self.assertNotIn('inputs/.studio/',json.dumps(report))
 def test_upload_and_quota_accounting(self):
  first=self.s.upload(self.a,self.pa,R/'inputs/test-fixtures/logo.png');self.assertEqual(first,self.s.upload(self.a,self.pa,R/'inputs/test-fixtures/logo.png'));self.assertGreater(self.s.usage(self.a)[0]['uploaded_bytes'],0)
 def test_safe_business_projection(self):
  from business_projection import public_business_projection
  source={'tenant_id':self.a.tenant_id,'business_name':'Demo','customers':[{'name':'PRIVATE FIXTURE'}],'appointments':['PRIVATE'],'services':[{'name':'Consulta','enabled':True,'public':True,'price':100,'price_public':False}],'professionals':[{'public_name':'Profesional A','public_name_approved':True},{'public_name':'Private','public_name_approved':False}]}
  projection=public_business_projection(self.a,source);self.assertNotIn('PRIVATE',json.dumps(projection));self.assertNotIn('public_price',projection['services'][0]);self.assertEqual(len(projection['professionals']),1)
  self.error('NOT_FOUND',lambda:public_business_projection(self.b,source))
 def test_expired_lease_and_retry_states(self):
  id=self.s.enqueue(self.a,self.pa,'preview','1');self.s.claim('node');self.s.db.execute('UPDATE video_jobs SET lease_until=0 WHERE id=?',(id,));self.assertIsNone(self.s.claim('node-2'))
  self.assertEqual(self.s.project(self.a,self.pa)['status'],'failed');self.s.retry(self.a,id);self.assertEqual(self.s.project(self.a,self.pa)['status'],'queued')
 def test_two_workers_claim_once(self):
  id=self.s.enqueue(self.a,self.pa,'preview','1');other=Studio(self.temp.name)
  try:self.assertEqual(self.s.claim('a')['id'],id);self.assertIsNone(other.claim('b'))
  finally:other.close()
 def test_db_rejects_cross_tenant_foreign_key(self):
  with self.assertRaises(sqlite3.IntegrityError):self.s.db.execute("INSERT INTO video_jobs(id,tenant_id,project_id,revision,status,mode,idempotency_key,config_json,fingerprint,queued_at) VALUES(?,?,?,1,'queued','preview','k','{}','f',0)",(str(uuid.uuid4()),self.b.tenant_id,self.pa))
class SafetyTests(unittest.TestCase):
 def test_prior_outputs_unchanged(self):
  baseline=read_json_unlimited(R/'tests/original-outputs.sha256.json')
  for p,sha in baseline.items():self.assertEqual(digest(R.parent/p),sha,p)
  current={str(p.relative_to(R.parent)) for name in ['brag-output','brag-output-2026-10-03-122343'] for p in (R.parent/name).rglob('*') if p.is_file()}
  self.assertEqual(current,set(baseline))
 def test_engine_has_no_production_connectors(self):
  for p in list((R/'scripts').glob('*.py'))+list((R/'backend').glob('*.py')):
   s=p.read_text();self.assertNotIn('import supabase',s);self.assertNotIn('load_dotenv',s);self.assertNotIn('requests.get(',s);self.assertNotIn('shell=True',s)
def read_json_unlimited(path):return json.loads(path.read_text())
if __name__=='__main__':unittest.main()
