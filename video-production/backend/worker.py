#!/usr/bin/env python3
"""Private pull worker. No HTTP listener. One process per render node; SQLite for one host."""
import argparse,json,os,resource,shutil,sys,time,subprocess
from pathlib import Path
from studio import Studio,Actor,fingerprint
from production import ROOT,process,write_json,read_json,fail
from tts_contract import TTS_ERRORS

def run_one(studio,node):
    job=studio.claim(node)
    if not job:return False
    os.umask(0o077)
    started=time.monotonic();r0=resource.getrusage(resource.RUSAGE_CHILDREN);out=None
    actor=Actor(job['tenant_id'],studio.db.execute('SELECT created_by FROM video_projects WHERE tenant_id=? AND id=?',(job['tenant_id'],job['project_id'])).fetchone()[0])
    metrics={}
    try:
        raw=json.loads(job['config_json'])
        if fingerprint(raw)!=job['fingerprint']:raise RuntimeError('STALE_ENGINE')
        normalized,report=studio.validated(actor,job['project_id'],raw,job['mode'])
        with studio.materialize(actor,job['project_id'],raw) as local:
            work=studio.root/job['tenant_id']/job['project_id']/'work'/job['id']/str(job['attempt']);work.mkdir(parents=True,exist_ok=True,mode=0o700)
            config=work/'worker-config.json';write_json(config,local)
            cmd=[sys.executable,ROOT/'scripts/generate-video.py','--config',config,'--mode',job['mode'],'--tenant-id',job['tenant_id']]
            if job['mode']=='final':cmd+=['--approve-final'] # Only claimable after server-side approval gate.
            try:
                result=process(cmd,capture_output=True,text=True,timeout=1500)
            except subprocess.CalledProcessError as exc:
                # Only bounded engine codes cross the worker boundary; no raw stderr.
                line=next((x[8:] for x in (exc.stdout or '').splitlines() if x.startswith('Output: ')),None)
                candidate=Path(line) if line else None
                if candidate and candidate.resolve().parent==(ROOT/'outputs').resolve():out=candidate
                code=(exc.stderr or '').split(':',1)[0].strip()
                if code in TTS_ERRORS | {'OVERLAPPING_SPEECH','VOICE_DUCKING_REQUIRED'}:fail(code,code)
                raise
            line=next(x for x in result.stdout.splitlines() if x.startswith('Output: '));out=Path(line[8:])
        metadata=read_json(out/'render-metadata.json');media=read_json(out/'media-verification.json')
        if metadata.get('tts'):
            report.update(ttsValidation='measured',ttsDurationSeconds=metadata['tts']['voiceDurationSeconds'])
        # Public artifacts use opaque asset IDs, never staging filesystem paths.
        write_json(out/'normalized-config.json',normalized)
        write_json(out/'validation-report.json',report)
        metadata['configReference']='tenant-scoped asset IDs in normalized-config.json';write_json(out/'render-metadata.json',metadata)
        r1=resource.getrusage(resource.RUSAGE_CHILDREN)
        metrics={'wallSeconds':round(time.monotonic()-started,3),'cpuSeconds':round(r1.ru_utime+r1.ru_stime-r0.ru_utime-r0.ru_stime,3),'width':media['width'],'height':media['height'],'durationMs':round(media['duration']*1000),'mode':job['mode']}
        files={'video':out/'final.mp4','poster':out/'poster.jpg','config':out/'normalized-config.json','validation':out/'validation-report.json','metadata':out/'render-metadata.json','share_copy':out/'share-copy.txt'}
        studio.finish(job,files,metrics)
    except Exception as e:
        r1=resource.getrusage(resource.RUSAGE_CHILDREN)
        studio.finish(job,{}, {'wallSeconds':time.monotonic()-started,'cpuSeconds':r1.ru_utime+r1.ru_stime-r0.ru_utime-r0.ru_stime},getattr(e,'code',None) or type(e).__name__)
    finally:
        if out and out.is_relative_to(ROOT/'outputs'):shutil.rmtree(out)
    return True
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--storage',default=str(ROOT/'storage/private'));p.add_argument('--node',default='local-render-1');p.add_argument('--once',action='store_true');a=p.parse_args();studio=Studio(a.storage)
    while True:
        worked=run_one(studio,a.node)
        if a.once:break
        if not worked:time.sleep(2)
