"""Trusted application boundary, not a public server. Actor comes from Citaya's auth guard."""
from dataclasses import dataclass
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime,timezone
import hashlib,json,mimetypes,os,shutil,sqlite3,sys,time,uuid
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from production import ROOT,ConfigError,fail,validate,schema_validate,tenant_schema_validate,inspect_media,parse_srt,digest,write_json
@dataclass(frozen=True)
class Actor:
    tenant_id: str
    user_id: str
    # Only a server-side authentication adapter may construct Actor.
    def __post_init__(self): uuid.UUID(self.tenant_id);uuid.UUID(self.user_id)

def uid():return str(uuid.uuid4())
def canonical(c):return json.dumps(c,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def fingerprint(c):
    dependencies=sorted((ROOT/'catalog').glob('*.json'))+sorted((ROOT/'templates').rglob('*.css'))+sorted((ROOT/'templates').rglob('template.json'))+sorted((ROOT/'scripts').glob('*.py'))+[ROOT/'schemas/video-config.schema.json',ROOT/'package-lock.json']
    return hashlib.sha256((canonical(c)+''.join(digest(p) for p in dependencies)).encode()).hexdigest()

def asset_ids(config):
    found=set()
    def walk(value):
        if isinstance(value,dict):
            for child in value.values():walk(child)
        elif isinstance(value,list):
            for child in value:walk(child)
        elif isinstance(value,str) and value.startswith('asset:') and len(value)>6:
            found.add(value[6:])
    walk(config)
    return sorted(found)

class Studio:
    def __init__(self,root,limits=None):
        self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(self.root,0o700)
        self.db=sqlite3.connect(self.root/'studio.sqlite',timeout=30,isolation_level=None);self.db.row_factory=sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL');self.db.executescript((Path(__file__).parent/'schema.sql').read_text());os.chmod(self.root/'studio.sqlite',0o600)
        self.limits=limits or {} # Trusted per-tenant/plan resolver; None means unbounded commercially.
    @contextmanager
    def tx(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:yield;self.db.execute('COMMIT')
        except BaseException:self.db.execute('ROLLBACK');raise
    def close(self):self.db.close()
    def row(self,table,actor,id):
        if table not in ['video_projects','video_assets','video_jobs','video_outputs']:raise ValueError('table')
        row=self.db.execute(f'SELECT * FROM {table} WHERE tenant_id=? AND id=?',(actor.tenant_id,id)).fetchone()
        if not row:fail('NOT_FOUND','Resource not found in this tenant.')
        return dict(row)
    def project(self,actor,id):return self.row('video_projects',actor,id)
    def output(self,actor,id):return self.row('video_outputs',actor,id)
    def download_path(self,actor,id):
        row=self.output(actor,id);p=(self.root/row['storage_path']).resolve()
        if not p.is_relative_to(self.root/actor.tenant_id) or not p.is_file():fail('NOT_FOUND','Output not found.')
        return p # Trusted adapter streams this; never return host paths to a browser.
    def list_projects(self,actor):return [dict(r) for r in self.db.execute('SELECT id,title,status,template_id,updated_at FROM video_projects WHERE tenant_id=? ORDER BY updated_at DESC',(actor.tenant_id,))]
    def create_project(self,actor,config,title='Nuevo video'):
        schema_validate(config)
        if len(title)>100:fail('INVALID_TITLE','Title too long.')
        # Tenant products represent their own business, not the Citaya platform roadmap.
        if config['product']!='custom-client-video':fail('TENANT_PRODUCT','Self-service uses custom-client-video. Internal CLI supports Citaya products.')
        id=uid();now=time.time()
        self.db.execute('INSERT INTO video_projects(id,tenant_id,created_by,template_id,status,title,video_type,niche,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(id,actor.tenant_id,actor.user_id,config.get('template','local-business-promo-v1'),'draft',title,config.get('videoType','promotion'),config.get('niche','professional-services'),canonical(config),now,now));return id
    def update_project(self,actor,id,config):
        schema_validate(config)
        if config['product']!='custom-client-video':fail('TENANT_PRODUCT','Self-service uses custom-client-video.')
        with self.tx():
            self.project(actor,id)
            if self.db.execute("SELECT 1 FROM video_jobs WHERE tenant_id=? AND project_id=? AND status IN ('queued','rendering')",(actor.tenant_id,id)).fetchone():fail('PROJECT_BUSY','Cancel or finish queued jobs before editing.')
            self.db.execute("UPDATE video_projects SET config_json=?,normalized_config_json=NULL,revision=revision+1,status='draft',template_id=?,video_type=?,niche=?,updated_at=? WHERE tenant_id=? AND id=?",(canonical(config),config.get('template','local-business-promo-v1'),config.get('videoType','promotion'),config.get('niche','professional-services'),time.time(),actor.tenant_id,id))
    def limit(self,actor,name,value):
        n=self.limits.get(actor.tenant_id,{}).get(name)
        if n is not None and value>n:fail('QUOTA_EXCEEDED',name+' exceeds the configured limit.')
    def record(self,tenant,key,kind,metrics,provider=None,provider_mode=None):
        period=datetime.now(timezone.utc).strftime('%Y-%m');id=uid()
        done=self.db.execute('INSERT OR IGNORE INTO video_usage_events VALUES(?,?,?,?,?,?,?,?,?)',(id,tenant,period,key,kind,provider,provider_mode,canonical(metrics),time.time())).rowcount
        if not done:return False
        self.db.execute('INSERT OR IGNORE INTO video_usage(tenant_id,period) VALUES(?,?)',(tenant,period))
        for k in ['previews_generated','finals_generated','render_seconds','cpu_seconds','ai_input_tokens','ai_output_tokens','storage_bytes','uploaded_bytes','output_bytes']:
            if k in metrics:self.db.execute(f'UPDATE video_usage SET {k}={k}+? WHERE tenant_id=? AND period=?',(metrics[k],tenant,period))
        return True
    def upload(self,actor,project_id,source):
        self.project(actor,project_id);src=Path(source)
        if src.is_symlink() or not src.is_file():fail('INVALID_UPLOAD','Upload must be a staged regular file.')
        ext=src.suffix.lower()
        if ext not in {'.jpg','.jpeg','.png','.webp','.mp4','.mov','.webm','.wav','.mp3','.m4a','.ogg','.srt','.vtt'}:fail('INVALID_MEDIA_TYPE','Unsupported upload type.')
        self.limit(actor,'max_upload_bytes',src.stat().st_size)
        if ext in ['.srt','.vtt']:
            if src.stat().st_size>100_000:fail('INVALID_SRT','Caption file too large.')
            parse_srt(src,120);info={'type':'caption','bytes':src.stat().st_size,'durationMs':0,'width':None,'height':None,'sha256':digest(src)}
        else:info=inspect_media(src)
        id=uid();rel=Path(actor.tenant_id)/project_id/'assets'/(id+ext);dest=self.root/rel;dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with self.tx():
            duplicate=self.db.execute('SELECT id FROM video_assets WHERE tenant_id=? AND project_id=? AND sha256=?',(actor.tenant_id,project_id,info['sha256'])).fetchone()
            if duplicate:return duplicate['id']
            usage=self.db.execute('SELECT COALESCE(SUM(size_bytes),0) FROM video_assets WHERE tenant_id=?',(actor.tenant_id,)).fetchone()[0]+self.db.execute('SELECT COALESCE(SUM(size_bytes),0) FROM video_outputs WHERE tenant_id=?',(actor.tenant_id,)).fetchone()[0]
            self.limit(actor,'max_storage_bytes',usage+info['bytes'])
            shutil.copyfile(src,dest);os.chmod(dest,0o600)
            self.db.execute('INSERT INTO video_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(id,actor.tenant_id,project_id,info['type'],str(rel),mimetypes.guess_type(dest)[0] or 'application/octet-stream',info['bytes'],info['durationMs'],info['width'],info['height'],info['sha256'],time.time()))
            self.record(actor.tenant_id,'upload:'+id,'upload',{'uploaded_bytes':info['bytes'],'storage_bytes':info['bytes'],'projectId':project_id,'assetId':id})
        return id
    @contextmanager
    def materialize(self,actor,project_id,config):
        self.project(actor,project_id);stage=ROOT/'inputs'/'.studio'/actor.tenant_id/project_id/uid();stage.mkdir(parents=True,mode=0o700)
        def walk(x):
            if isinstance(x,dict):return {k:walk(v) for k,v in x.items()}
            if isinstance(x,list):return [walk(v) for v in x]
            if isinstance(x,str):
                if x.startswith('asset:'):
                    a=self.row('video_assets',actor,x[6:])
                    if a['project_id']!=project_id:fail('ASSET_PROJECT_MISMATCH','Asset does not belong to this project.')
                    source=(self.root/a['storage_path']).resolve()
                    if not source.is_relative_to(self.root/actor.tenant_id) or digest(source)!=a['sha256']:fail('ASSET_INTEGRITY','Asset integrity failed.')
                    dest=stage/(a['id']+source.suffix);shutil.copyfile(source,dest);os.chmod(dest,0o600);return str(dest.relative_to(ROOT))
                if x.startswith(('inputs/','./inputs/','assets/','./assets/','/','file:')):fail('TENANT_ASSET_REFERENCE','Tenant media must use asset:<id>, not filesystem paths.')
            return x
        try:yield walk(config)
        finally:shutil.rmtree(stage)
    def validated(self,actor,project_id,config,mode):
        schema_validate(config)
        if config.get('commercialProfile'):fail('TENANT_COMMERCIAL_PROFILE','Tenant AI cannot select internal operational profiles.')
        if config['product']!='custom-client-video':fail('TENANT_PRODUCT','Self-service supports reviewed business content only.')
        with self.materialize(actor,project_id,config) as local:
            normalized,report,_=validate(local,mode)
        def restore(x):
            if isinstance(x,dict):return {k:restore(v) for k,v in x.items()}
            if isinstance(x,list):return [restore(v) for v in x]
            if isinstance(x,str) and x.startswith('inputs/.studio/'):return 'asset:'+Path(x).stem
            return x
        normalized=restore(normalized)
        report['mediaSha256']={restore(k):v for k,v in report['mediaSha256'].items()}
        tenant_schema_validate(config)
        self.limit(actor,'max_duration_seconds',report['duration'])
        # Persist opaque IDs only; staged paths never escape the worker boundary.
        return normalized,report
    def validate_project(self,actor,project_id):
        p=self.project(actor,project_id);normalized,report=self.validated(actor,project_id,json.loads(p['config_json']),'preview')
        with self.tx():
            current=self.project(actor,project_id)
            if current['revision']!=p['revision']:fail('STALE_CONFIG','Project changed during validation.')
            if current['status'] not in ['draft','validated','completed','failed','cancelled']:fail('PROJECT_BUSY','Wait for or cancel active jobs.')
            self.db.execute("UPDATE video_projects SET status='validated',normalized_config_json=?,updated_at=? WHERE tenant_id=? AND id=?",(canonical(normalized),time.time(),actor.tenant_id,project_id))
        return report
    def enqueue(self,actor,project_id,mode,idempotency_key):
        if mode not in ['preview','final'] or not isinstance(idempotency_key,str) or not 1<=len(idempotency_key)<=100:fail('INVALID_JOB','Mode and idempotency key required.')
        p=self.project(actor,project_id);config=json.loads(p['config_json']);normalized,report=self.validated(actor,project_id,config,mode);fp=fingerprint(config)
        with self.tx():
            p2=self.project(actor,project_id)
            if p2['revision']!=p['revision']:fail('STALE_CONFIG','Project changed during validation.')
            existing=self.db.execute('SELECT id,fingerprint FROM video_jobs WHERE tenant_id=? AND project_id=? AND mode=? AND idempotency_key=?',(actor.tenant_id,project_id,mode,idempotency_key)).fetchone()
            if existing:
                if existing['fingerprint']!=fp:fail('IDEMPOTENCY_CONFLICT','Key belongs to another configuration.')
                return existing['id']
            if self.db.execute("SELECT 1 FROM video_jobs WHERE tenant_id=? AND project_id=? AND status IN ('queued','rendering')",(actor.tenant_id,project_id)).fetchone():fail('PROJECT_BUSY','Only one active render per project.')
            period=datetime.now(timezone.utc).strftime('%Y-%m')
            usage=self.db.execute('SELECT COUNT(*) FROM video_jobs WHERE tenant_id=? AND status IN (\'queued\',\'rendering\',\'completed\') AND queued_at>=?',(actor.tenant_id,datetime.now(timezone.utc).replace(day=1,hour=0,minute=0,second=0,microsecond=0).timestamp())).fetchone()[0]
            self.limit(actor,'max_videos_per_month',usage+1)
            if mode=='final':
                finals=self.db.execute("SELECT COUNT(*) FROM video_jobs WHERE tenant_id=? AND mode='final' AND status IN ('queued','rendering','completed') AND queued_at>=?",(actor.tenant_id,datetime.now(timezone.utc).replace(day=1,hour=0,minute=0,second=0,microsecond=0).timestamp())).fetchone()[0]
                self.limit(actor,'max_final_renders',finals+1)
                approval=self.db.execute('SELECT id FROM video_approvals WHERE tenant_id=? AND project_id=? AND revision=? AND fingerprint=? AND consumed_by_job_id IS NULL ORDER BY approved_at DESC LIMIT 1',(actor.tenant_id,project_id,p['revision'],fp)).fetchone()
                if not approval:fail('FINAL_APPROVAL_REQUIRED','A completed current preview must be explicitly approved by the user.')
            id=uid();self.db.execute('INSERT INTO video_jobs(id,tenant_id,project_id,revision,status,mode,idempotency_key,config_json,fingerprint,queued_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(id,actor.tenant_id,project_id,p['revision'],'queued',mode,idempotency_key,canonical(config),fp,time.time()))
            if mode=='final':self.db.execute('UPDATE video_approvals SET consumed_by_job_id=? WHERE id=?',(id,approval['id']))
            self.db.execute("UPDATE video_projects SET status='queued',normalized_config_json=?,updated_at=? WHERE tenant_id=? AND id=?",(canonical(normalized),time.time(),actor.tenant_id,project_id))
            return id
    def approve_final(self,actor,preview_job_id):
        with self.tx():
            job=self.row('video_jobs',actor,preview_job_id);p=self.project(actor,job['project_id']);fp=fingerprint(json.loads(p['config_json']))
            if job['mode']!='preview' or job['status']!='completed' or job['revision']!=p['revision'] or fp!=job['fingerprint']:fail('PREVIEW_APPROVAL_INVALID','Approve a completed preview of the current revision and engine.')
            id=uid();self.db.execute('INSERT INTO video_approvals VALUES(?,?,?,?,?,?,?,?,NULL)',(id,actor.tenant_id,p['id'],job['id'],p['revision'],fp,actor.user_id,time.time()));return id
    def claim(self,node,lease_seconds=1800):
        with self.tx():
            # Lost leases fail closed. An operator can retry the SAME job, preserving idempotence.
            expired=self.db.execute("SELECT tenant_id,project_id FROM video_jobs WHERE status='rendering' AND lease_until<?",(time.time(),)).fetchall()
            self.db.execute("UPDATE video_jobs SET status='failed',error_code='LEASE_EXPIRED',finished_at=? WHERE status='rendering' AND lease_until<?",(time.time(),time.time()))
            for old in expired:self.db.execute("UPDATE video_projects SET status='failed' WHERE tenant_id=? AND id=?",(old['tenant_id'],old['project_id']))
            job=self.db.execute("SELECT * FROM video_jobs WHERE status='queued' ORDER BY queued_at LIMIT 1").fetchone()
            if not job:return None
            token=uid();self.db.execute("UPDATE video_jobs SET status='rendering',started_at=?,render_node=?,attempt=attempt+1,lease_token=?,lease_until=? WHERE id=?",(time.time(),node,token,time.time()+lease_seconds,job['id']))
            self.db.execute("UPDATE video_projects SET status='rendering' WHERE tenant_id=? AND id=?",(job['tenant_id'],job['project_id']))
            return dict(self.db.execute('SELECT * FROM video_jobs WHERE id=?',(job['id'],)).fetchone())
    def heartbeat(self,job_id,token):
        return self.db.execute("UPDATE video_jobs SET lease_until=? WHERE id=? AND lease_token=? AND status='rendering' AND lease_until>?",(time.time()+1800,job_id,token,time.time())).rowcount==1
    def cancel(self,actor,job_id):
        with self.tx():
            job=self.row('video_jobs',actor,job_id)
            if job['status'] not in ['queued','rendering']:fail('INVALID_TRANSITION','Only queued/rendering jobs can be cancelled.')
            self.db.execute("UPDATE video_jobs SET status='cancelled',finished_at=?,lease_token=NULL WHERE tenant_id=? AND id=?",(time.time(),actor.tenant_id,job_id));self.db.execute("UPDATE video_projects SET status='cancelled' WHERE tenant_id=? AND id=?",(actor.tenant_id,job['project_id']))
    def retry(self,actor,job_id):
        with self.tx():
            job=self.row('video_jobs',actor,job_id)
            if job['status']!='failed':fail('INVALID_TRANSITION','Only failed jobs can retry.')
            p=self.project(actor,job['project_id'])
            if self.db.execute("SELECT 1 FROM video_jobs WHERE tenant_id=? AND project_id=? AND status IN ('queued','rendering')",(actor.tenant_id,p['id'])).fetchone():fail('PROJECT_BUSY','An active job already exists.')
            if job['revision']!=p['revision'] or fingerprint(json.loads(p['config_json']))!=job['fingerprint']:fail('STALE_CONFIG','Create a new preview after configuration or engine changes.')
            self.db.execute("UPDATE video_jobs SET status='queued',error_code=NULL,lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND id=?",(actor.tenant_id,job_id))
            self.db.execute("UPDATE video_projects SET status='queued' WHERE tenant_id=? AND id=?",(actor.tenant_id,job['project_id']))
    def finish(self,job,files,metrics,error=None):
        with self.tx():
            current=self.db.execute('SELECT * FROM video_jobs WHERE id=?',(job['id'],)).fetchone()
            if current['status']=='completed' and current['lease_token']==job['lease_token']:return False
            # Record actual attempt resources even if cancelled; successful-output counters are separate.
            self.record(job['tenant_id'],f'attempt:{job["id"]}:{job["attempt"]}','render_attempt',{'render_seconds':metrics.get('wallSeconds',0),'cpu_seconds':metrics.get('cpuSeconds',0),'mode':job['mode'],'projectId':job['project_id'],'jobId':job['id'],'attempt':job['attempt'],'errorCode':error})
            if current['status']!='rendering' or current['lease_token']!=job['lease_token'] or current['lease_until']<time.time():return False
            if error:
                self.db.execute("UPDATE video_jobs SET status='failed',error_code=?,finished_at=? WHERE id=?",(error,time.time(),job['id']));self.db.execute("UPDATE video_projects SET status='failed' WHERE tenant_id=? AND id=?",(job['tenant_id'],job['project_id']));return False
            total=0
            for output_type,path in files.items():
                src=Path(path);rel=Path(job['tenant_id'])/job['project_id']/'outputs'/job['id']/(output_type+src.suffix);dest=self.root/rel;dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700);shutil.copyfile(src,dest);os.chmod(dest,0o600);total+=dest.stat().st_size
                self.db.execute('INSERT INTO video_outputs VALUES(?,?,?,?,?,?,?,?,?,?,?)',(uid(),job['tenant_id'],job['project_id'],job['id'],output_type,str(rel),metrics.get('width'),metrics.get('height'),metrics.get('durationMs'),dest.stat().st_size,digest(dest)))
            referenced=asset_ids(json.loads(job['config_json']))
            input_bytes=0
            if referenced:
                placeholders=','.join('?' for _ in referenced)
                input_bytes=self.db.execute(f'SELECT COALESCE(SUM(size_bytes),0) FROM video_assets WHERE tenant_id=? AND project_id=? AND id IN ({placeholders})',(job['tenant_id'],job['project_id'],*referenced)).fetchone()[0]
            self.record(job['tenant_id'],'complete:'+job['id'],'render_complete',{'previews_generated':int(job['mode']=='preview'),'finals_generated':int(job['mode']=='final'),'input_bytes':input_bytes,'output_bytes':total,'storage_bytes':total,'projectId':job['project_id'],'jobId':job['id'],'assetCount':len(referenced),'outputCount':len(files),**metrics})
            self.db.execute("UPDATE video_jobs SET status='completed',finished_at=?,render_seconds=?,cpu_seconds=? WHERE id=?",(time.time(),metrics.get('wallSeconds',0),metrics.get('cpuSeconds',0),job['id']));self.db.execute("UPDATE video_projects SET status='completed' WHERE tenant_id=? AND id=?",(job['tenant_id'],job['project_id']));return True
    def record_ai(self,actor,request_id,provider,provider_mode,input_tokens,output_tokens,project_id=None,job_id=None,model=None,latency_seconds=None):
        if provider_mode not in ['local','cloud'] or any(type(x)!=int or x<0 for x in [input_tokens,output_tokens]):fail('INVALID_USAGE','Actual non-negative provider token counts required.')
        if not isinstance(request_id,str) or not request_id or not isinstance(provider,str) or not provider:fail('INVALID_USAGE','AI request/provider identifiers are required.')
        if model is not None and (not isinstance(model,str) or not model.strip()):fail('INVALID_USAGE','AI model must be non-empty text.')
        if latency_seconds is not None and (type(latency_seconds) not in (int,float) or latency_seconds<0):fail('INVALID_USAGE','AI latency must be a non-negative number.')
        if project_id is not None:self.project(actor,project_id)
        if job_id is not None:
            job=self.row('video_jobs',actor,job_id)
            if project_id is not None and job['project_id']!=project_id:fail('INVALID_USAGE','AI job does not belong to the supplied project.')
            project_id=job['project_id']
        metrics={'ai_input_tokens':input_tokens,'ai_output_tokens':output_tokens,'ai_total_tokens':input_tokens+output_tokens}
        if project_id is not None:metrics['projectId']=project_id
        if job_id is not None:metrics['jobId']=job_id
        if model is not None:metrics['model']=model.strip()
        if latency_seconds is not None:metrics['latencySeconds']=round(float(latency_seconds),6)
        with self.tx():
            # Record actual incurred usage even if it exceeded a future plan limit. Budget checks belong before provider invocation.
            return self.record(actor.tenant_id,'ai:'+request_id,'ai',metrics,provider,provider_mode)
    def record_ai_usage(self,actor,request_id,usage,project_id=None,job_id=None,provider_mode='local'):
        if not isinstance(usage,dict) or usage.get('usageComplete') is not True:
            fail('INVALID_USAGE','Complete provider-reported AI usage is required.')
        provider=usage.get('provider');model=usage.get('model')
        if not isinstance(model,str) or not model.strip():
            fail('INVALID_USAGE','Complete AI usage must identify the provider model.')
        input_tokens=usage.get('inputTokens');output_tokens=usage.get('outputTokens');total_tokens=usage.get('totalTokens')
        latency=usage.get('elapsedSeconds')
        if any(type(x)!=int or x<0 for x in [input_tokens,output_tokens,total_tokens]) or total_tokens!=input_tokens+output_tokens:
            fail('INVALID_USAGE','AI token totals must be complete and internally consistent.')
        if type(latency) not in (int,float) or latency<0:
            fail('INVALID_USAGE','AI elapsedSeconds must be a non-negative number.')
        return self.record_ai(actor,request_id,provider,provider_mode,input_tokens,output_tokens,project_id=project_id,job_id=job_id,model=model,latency_seconds=latency)
    def project_usage_report(self,actor,project_id):
        project=self.project(actor,project_id)
        events=[]
        for row in self.db.execute('SELECT event_type,provider,provider_mode,metrics_json,created_at FROM video_usage_events WHERE tenant_id=? ORDER BY created_at',(actor.tenant_id,)):
            item=dict(row)
            try: metrics=json.loads(item['metrics_json'])
            except (TypeError,ValueError): continue
            if metrics.get('projectId')!=project_id: continue
            item['metrics']=metrics;events.append(item)
        ai=[e for e in events if e['event_type']=='ai']
        attempts=[e for e in events if e['event_type']=='render_attempt']
        completed=[e for e in events if e['event_type']=='render_complete']
        jobs=[dict(r) for r in self.db.execute('SELECT id,mode,status,attempt,render_seconds,cpu_seconds,queued_at,started_at,finished_at,error_code FROM video_jobs WHERE tenant_id=? AND project_id=? ORDER BY queued_at',(actor.tenant_id,project_id))]
        outputs=[dict(r) for r in self.db.execute('SELECT id,job_id,output_type,width,height,duration_ms,size_bytes FROM video_outputs WHERE tenant_id=? AND project_id=? ORDER BY job_id,output_type',(actor.tenant_id,project_id))]
        assets=[dict(r) for r in self.db.execute('SELECT id,asset_type,size_bytes,duration_ms,width,height FROM video_assets WHERE tenant_id=? AND project_id=? ORDER BY created_at',(actor.tenant_id,project_id))]
        by_job={}
        for job in jobs:
            job_outputs=[x for x in outputs if x['job_id']==job['id']]
            complete=next((e for e in completed if e['metrics'].get('jobId')==job['id']),None)
            by_job[job['id']]={**job,
                'inputBytes':int(complete['metrics'].get('input_bytes',0)) if complete else 0,
                'outputBytes':sum(x['size_bytes'] for x in job_outputs),
                'assetCount':int(complete['metrics'].get('assetCount',0)) if complete else 0,
                'outputs':job_outputs}
        providers=sorted({e['provider'] for e in ai if e.get('provider')})
        provider_modes=sorted({e['provider_mode'] for e in ai if e.get('provider_mode')})
        models=sorted({e['metrics'].get('model') for e in ai if e['metrics'].get('model')})
        ai_latency=sum(float(e['metrics'].get('latencySeconds',0)) for e in ai)
        return {
            'projectId':project_id,
            'title':project['title'],
            'status':project['status'],
            'ai':{
                'requests':len(ai),
                'inputTokens':sum(int(e['metrics'].get('ai_input_tokens',0)) for e in ai),
                'outputTokens':sum(int(e['metrics'].get('ai_output_tokens',0)) for e in ai),
                'totalTokens':sum(int(e['metrics'].get('ai_total_tokens',e['metrics'].get('ai_input_tokens',0)+e['metrics'].get('ai_output_tokens',0))) for e in ai),
                'latencySeconds':round(ai_latency,6),
                'providers':providers,
                'providerModes':provider_modes,
                'models':models,
            },
            'render':{
                'attempts':len(attempts),
                'completed':len(completed),
                'previews':sum(int(e['metrics'].get('previews_generated',0)) for e in completed),
                'finals':sum(int(e['metrics'].get('finals_generated',0)) for e in completed),
                'wallSeconds':round(sum(float(e['metrics'].get('render_seconds',0)) for e in attempts),6),
                'cpuSeconds':round(sum(float(e['metrics'].get('cpu_seconds',0)) for e in attempts),6),
            },
            'bytes':{
                'uploaded':sum(x['size_bytes'] for x in assets),
                'inputConsumed':sum(int(e['metrics'].get('input_bytes',0)) for e in completed),
                'output':sum(x['size_bytes'] for x in outputs),
                'currentStorage':sum(x['size_bytes'] for x in assets)+sum(x['size_bytes'] for x in outputs),
            },
            'assets':assets,
            'jobs':list(by_job.values()),
        }
    def usage_summary(self,actor):
        rows=self.usage(actor)
        totals={k:0 for k in ['previews_generated','finals_generated','render_seconds','cpu_seconds','ai_input_tokens','ai_output_tokens','storage_bytes','uploaded_bytes','output_bytes']}
        for row in rows:
            for key in totals:totals[key]+=row[key]
        totals['ai_total_tokens']=totals['ai_input_tokens']+totals['ai_output_tokens']
        totals['current_storage_bytes']=rows[0]['current_storage_bytes'] if rows else 0
        totals['periods']=len(rows)
        return {'periods':rows,'totals':totals}
    def usage(self,actor):
        rows=[dict(r) for r in self.db.execute('SELECT * FROM video_usage WHERE tenant_id=? ORDER BY period DESC',(actor.tenant_id,))]
        current=self.db.execute('SELECT COALESCE(SUM(size_bytes),0) FROM video_assets WHERE tenant_id=?',(actor.tenant_id,)).fetchone()[0]+self.db.execute('SELECT COALESCE(SUM(size_bytes),0) FROM video_outputs WHERE tenant_id=?',(actor.tenant_id,)).fetchone()[0]
        for row in rows:row['current_storage_bytes']=current
        return rows
