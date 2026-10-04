"""V2 poster and media verification generalized to configured dimensions/duration."""
import json,shutil
from production import process,probe,write_json

def finalize(video,poster,settings,duration,poster_time,report_path):
    process(['ffmpeg','-y','-v','error','-ss',poster_time,'-i',video,'-frames:v','1','-q:v','2',poster],timeout=60)
    temp=video.with_name('poster-bake.mp4')
    process(['ffmpeg','-y','-v','error','-i',video,'-i',poster,'-filter_complex',"[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]",'-map','[v]','-map','0:a?','-map_metadata','-1','-c:v','libx264','-crf','20' if settings['width']==720 else '18','-preset','fast' if settings['width']==720 else 'slow','-threads','4','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',temp],timeout=600)
    info=probe(temp);v=next(s for s in info['streams'] if s['codec_type']=='video');a=next(s for s in info['streams'] if s['codec_type']=='audio')
    frames=round(duration*settings['fps'])
    if (v['width'],v['height'])!=(settings['width'],settings['height']) or abs(float(v['duration'])-duration)>1/settings['fps']+.001 or abs(int(v['nb_frames'])-frames)>1: raise RuntimeError('Final media geometry, duration or frame count mismatch.')
    process(['ffmpeg','-v','error','-i',temp,'-f','null','-'],timeout=180)
    levels=process(['ffmpeg','-hide_banner','-i',temp,'-vn','-af','volumedetect','-f','null','-'],capture_output=True,text=True,timeout=60).stderr
    report={'width':v['width'],'height':v['height'],'duration':float(v['duration']),'frames':int(v['nb_frames']),'fps':v['r_frame_rate'],'videoCodec':v['codec_name'],'audioCodec':a['codec_name'],'audioChannels':a['channels'],'posterTime':poster_time,'posterBakedIntoFrameZero':True,'decode':'pass','audioLevels':[l.split(']')[-1].strip() for l in levels.splitlines() if 'mean_volume' in l or 'max_volume' in l]}
    temp.replace(video);write_json(report_path,report);return report
