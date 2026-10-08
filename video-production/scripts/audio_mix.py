"""FFmpeg speech mixer: recorded and trusted generated segments share one pipeline."""
from production import ROOT,process,write_json,fail
from tts_provider import generated_path

def mix_audio(c,ctx,out,comp):
    if c['audio'].get('tts',{}).get('enabled') and (not ctx.get('ttsMetadata') or not any(s.get('generatedPath') for s in ctx['speech'])):
        fail('TTS_SYNTHESIS_FAILED','TTS_SYNTHESIS_FAILED')
    duration=sum(c['timing'].values());tmp=out/'audio-work';tmp.mkdir(exist_ok=True,mode=0o700)
    speech=[]
    for i,s in enumerate(ctx['speech']):
        p=tmp/f'voice-{i}.wav'
        source=ROOT/s['path'] if 'generatedPath' not in s else generated_path(s['generatedPath'],out)
        # Generated narration has already passed the duration gate; read it whole.
        trim=['-ss',s['offset'],'-t',s['duration']] if 'generatedPath' not in s else []
        process(['ffmpeg','-y','-v','error','-protocol_whitelist','file,pipe',*trim,'-i',source,'-vn','-af','highpass=f=80,loudnorm=I=-16:TP=-2:LRA=7','-ar','48000','-ac','2',p],timeout=120)
        speech.append((p,s['start']))
    args=['ffmpeg','-y','-v','error'];filters=[];tracks=[];index=0
    # Always finite silence so a no-music/no-voice configuration still exports valid audio.
    args+=['-f','lavfi','-t',duration,'-i','anullsrc=r=48000:cl=stereo'];tracks.append('[0:a]');index+=1
    voice=None
    for p,start in speech:
        args+=['-i',p];label=f'v{index}';filters.append(f'[{index}:a]adelay={round(start*1000)}|{round(start*1000)},apad,atrim=duration={duration}[{label}]');tracks.append('['+label+']');index+=1
    if speech:
        filters.append(''.join(tracks)+f'amix=inputs={len(tracks)}:normalize=0:duration=longest,asplit=3[voice][key1][key2]');voice='[voice]';tracks=[]
    if c['audio']['music']:
        args+=['-stream_loop','-1','-ss','0','-i',ROOT/c['media']['backgroundMusic'] if c.get('media',{}).get('backgroundMusic') else ROOT/'assets/music/studio-original.wav'];filters.append(f'[{index}:a]atrim=duration={duration},asetpts=PTS-STARTPTS,loudnorm=I=-20:TP=-2:LRA=9,aresample=48000,afade=t=in:d=0.12,afade=t=out:st={duration-.9}:d=0.9[bed]');index+=1
        if speech:
            # Carve the speech band dynamically as well as ducking the whole music bed.
            filters.append('[bed]acrossover=split=250 3200:order=4th[low][mid][high]')
            filters.append('[mid][key1]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=650:makeup=1[midduck]')
            filters.append('[low][midduck][high]amix=inputs=3:normalize=0[carved]')
            filters.append('[carved][key2]sidechaincompress=threshold=0.025:ratio=5:attack=25:release=700:makeup=1[ducked]');tracks.append('[ducked]')
        else:tracks.append('[bed]')
    elif speech:
        filters+=['[key1]anullsink','[key2]anullsink']
    if voice:tracks.append(voice)
    if c['audio']['sfx']:
        clock=c['timing']['intro'];cues=[(clock,'hit.ogg')]
        for s in c['scenes']:
            cues.append((clock+min(.65,s['duration']*.35),'tap.ogg'));clock+=s['duration']
        cues.append((clock+.1,'success.ogg'))
        for j,(start,name) in enumerate(cues):
            custom_sfx=c.get('media',{}).get('soundEffects',[])
            args+=['-i',ROOT/custom_sfx[j%len(custom_sfx)] if custom_sfx else ROOT/'assets/sfx'/name];label=f'sfx{j}';filters.append(f'[{index}:a]volume=0.18,adelay={round(start*1000)}|{round(start*1000)},apad,atrim=duration={duration}[{label}]');tracks.append('['+label+']');index+=1
    filters.append(''.join(tracks)+f'amix=inputs={len(tracks)}:normalize=0:duration=longest,atrim=duration={duration},alimiter=limit=0.8913:level=false,aresample=48000[master]')
    script=tmp/'mix.ffscript';script.write_text(';\n'.join(filters))
    args+=['-filter_complex_script',script,'-map','[master]','-t',duration,'-ar','48000','-ac','2',comp/'assets/master.wav']
    process(args,timeout=180)
    write_json(out/'audio-metadata.json',{'speechSegments':[{'start':s['start'],'duration':s['duration']} for s in ctx['speech']],'ducking':'speech-driven sidechain with 700ms release' if speech and c['audio']['music'] else None,'spectralCarve':'250–3200 Hz, dynamic 650ms release' if speech and c['audio']['music'] else None,'voiceProvider':None,'music':c['audio']['music'],'sfx':c['audio']['sfx'],**ctx.get('ttsMetadata',{})})
