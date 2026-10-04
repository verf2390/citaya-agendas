#!/usr/bin/env python3
"""Idea -> validated JSON -> versioned template -> local HyperFrames/FFmpeg -> MP4."""
import argparse,json,sys,time,uuid,subprocess,resource
from datetime import datetime,timezone
from pathlib import Path
from production import *
from compose import compile_composition
from audio_mix import mix_audio
from finalize_video import finalize

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--approve-final',action='store_true',help='Human operator approval; never accepted inside AI JSON.');p.add_argument('--tenant-id',default='00000000-0000-0000-0000-000000000001',help='Trusted worker/internal operator context, never AI JSON.');p.add_argument('--config',required=True);p.add_argument('--mode',choices=MODES,default='preview');p.add_argument('--validate-only',action='store_true');p.add_argument('--prepare-only',action='store_true',help='Compile and mix locally without invoking the renderer.')
    a=p.parse_args()
    if a.mode=='final' and not (a.approve_final or a.validate_only):fail('FINAL_APPROVAL_REQUIRED','Final render requires explicit --approve-final from the operator or approved queue worker.')
    uuid.UUID(a.tenant_id)
    c,r,ctx=validate(read_json(a.config),a.mode)
    if a.validate_only: print(json.dumps(r,ensure_ascii=False,indent=2));return
    binary=ROOT/'node_modules/.bin/hyperframes'
    if not binary.is_file():fail('DEPENDENCY_MISSING','Run npm ci --prefix video-production once. Rendering never installs packages or calls a cloud model.')
    start=time.monotonic();cpu_start=resource.getrusage(resource.RUSAGE_CHILDREN);stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ');out=ROOT/'outputs'/f'{stamp}-{c["product"]}-{a.mode}-{uuid.uuid4().hex[:6]}'
    out.mkdir(parents=True,exist_ok=False)
    write_json(out/'normalized-config.json',c);write_json(out/'validation-report.json',r)
    # Store an immutable truth snapshot, not just a hash pointing at a mutable catalog.
    write_json(out/'capability-snapshot.json',{i:ctx['caps'][i] for i in c['capabilities']})
    metadata={'tenant_id':a.tenant_id,'status':'preparing','mode':a.mode,'duration':r['duration'],'resolution':MODES[a.mode],'createdAt':stamp,'template':c['template'],'templateVersion':ctx['template']['version'],'hyperframesVersion':'0.8.114','configSha256':digest(out/'normalized-config.json'),'catalogSha256':r['catalogSha256'],'localOnly':True}
    write_json(out/'render-metadata.json',metadata)
    print('Output: '+str(out),flush=True)
    try:
        comp,proof=compile_composition(c,ctx,out,a.mode);mix_audio(c,ctx,out,comp)
        metadata['compositionSha256']=digest(comp/'index.html');metadata['posterTime']=round(min(c['timing']['intro']-.2,max(.4,c['timing']['intro']*.6)),3)
        (out/'share-copy.txt').write_text(c['shareCopy']+'\n',encoding='utf-8')
        (out/'instagram-caption.txt').write_text(c['shareCopy']+'\n',encoding='utf-8')
        (out/'whatsapp-promotion.txt').write_text(c['hook']+' '+c['cta']+'\n',encoding='utf-8')
        (out/'short-ad-copy.txt').write_text(c['secondaryHook']+' '+c['cta']+'\n',encoding='utf-8')
        if a.prepare_only:
            metadata['status']='prepared';write_json(out/'render-metadata.json',metadata);print('Prepared; no MP4 rendered.');return
        print('Checking layout, runtime and contrast…',flush=True)
        try:result=process([binary,'check',comp,'--at',','.join(f'{n:.3f}' for n in proof),'--json'],capture_output=True,text=True,timeout=300)
        except subprocess.CalledProcessError as e:
            (out/'check-failed.json').write_text(e.stdout or '{}');(out/'check-error.log').write_text(e.stderr or '');raise
        try:check=json.loads(result.stdout)
        except ValueError:raise RuntimeError('Renderer returned a non-JSON check report.')
        write_json(out/'hyperframes-check.json',check)
        # Current CLI sometimes labels contrast failures warnings. Gate those as well.
        if not check.get('ok') or any(x.get('errorCount',0) for x in check.values() if isinstance(x,dict)) or check.get('contrast',{}).get('findings') or check.get('layout',{}).get('warningCount',0):raise RuntimeError('Composition validation failed; inspect hyperframes-check.json.')
        if not check.get('contrast',{}).get('checked'):raise RuntimeError('No text contrast was checked; renderer gate was skipped.')
        for media,sha in r['mediaSha256'].items():
            if digest(ROOT/media)!=sha:raise RuntimeError('Reviewed input changed during production: '+media)
        print('Rendering '+a.mode+' locally…',flush=True)
        with (out/'render.log').open('w') as log:process([binary,'render',comp,'--quality',MODES[a.mode]['quality'],'--fps',MODES[a.mode]['fps'],'--output',out/'final.mp4'],stdout=log,stderr=subprocess.STDOUT,timeout=1200)
        final=finalize(out/'final.mp4',out/'poster.jpg',MODES[a.mode],r['duration'],metadata['posterTime'],out/'media-verification.json')
        metadata.update(status='complete',elapsedSeconds=round(time.monotonic()-start,2),outputSha256=digest(out/'final.mp4'),media=final)
        print('Complete: '+str(out/'final.mp4'),flush=True)
    except Exception as e:
        metadata.update(status='failed',error=type(e).__name__,message=str(e)[:800]);raise
    finally:
        cpu_end=resource.getrusage(resource.RUSAGE_CHILDREN)
        metadata.update(wallSeconds=round(time.monotonic()-start,3),cpuSeconds=round(cpu_end.ru_utime+cpu_end.ru_stime-cpu_start.ru_utime-cpu_start.ru_stime,3),ai={'provider':None,'mode':None,'inputTokens':0,'outputTokens':0},outputBytes=(out/'final.mp4').stat().st_size if (out/'final.mp4').exists() else 0)
        write_json(out/'render-metadata.json',metadata)

if __name__=='__main__':
    try:main()
    except ConfigError as e:print(f'{e.code}: {e}',file=sys.stderr);sys.exit(2)
    except (RuntimeError,subprocess.SubprocessError,OSError) as e:print(f'PRODUCTION_FAILED: {e}',file=sys.stderr);sys.exit(1)
