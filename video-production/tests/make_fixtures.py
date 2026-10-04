from pathlib import Path
import subprocess,sys,json
R=Path(__file__).resolve().parents[1];F=R/'inputs/test-fixtures';F.mkdir(parents=True,exist_ok=True)
def run(*args):subprocess.run(['ffmpeg','-y','-v','error',*map(str,args)],check=True)
run('-f','lavfi','-i','color=c=0x186A61:s=540x660','-vf',"drawtext=text='NEGOCIO DEMO':fontcolor=white:fontsize=38:x=(w-tw)/2:y=h/2",'-frames:v','1','-threads','1',F/'business.png')
run('-f','lavfi','-i','color=c=0xffffff:s=400x160','-vf',"drawtext=text='DEMO':fontcolor=0x186A61:fontsize=60:x=(w-tw)/2:y=(h-th)/2",'-frames:v','1','-threads','1',F/'logo.png')
run('-f','lavfi','-i','color=c=0x334155:s=360x640:r=24','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','3','-vf',"drawtext=text='INTRO DE PRUEBA':fontcolor=white:fontsize=25:x=(w-tw)/2:y=h/2",'-c:v','libx264','-preset','ultrafast','-c:a','aac','-pix_fmt','yuv420p',F/'intro.mp4')
run('-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-af',"volume='if(between(t,1,2),0,0.25)':eval=frame",F/'voice.wav')
(F/'captions.srt').write_text('1\n00:00:00,000 --> 00:00:02,900\nIntroducción de demostración\n\n2\n00:00:03,000 --> 00:00:06,900\nContenido de prueba\n')
(F/'captions.vtt').write_text('WEBVTT\n\n00:00:00.000 --> 00:00:02.900\nIntroducción de demostración\n')
custom={'product':'custom-client-video','template':'local-business-promo-v1','niche':'veterinary','videoType':'promotion','brand':{'businessName':'Veterinaria Demo','logo':'inputs/test-fixtures/logo.png','primaryColor':'#186A61','secondaryColor':'#FFFFFF'},'media':{'images':['inputs/test-fixtures/business.png']},'content':{'hook':'Más tiempo para cuidar.','secondaryHook':'Conoce nuestros servicios.','benefit':'Atención para tu mascota.','cta':'Conversemos'},'mediaPolicy':{'useOnlyProvidedAssets':True,'allowStockMedia':False,'allowGeneratedMedia':False},'mediaApproved':True,'timing':{'intro':2.5,'demo':5,'outro':2.5}}
(R/'configs/examples/local-business.json').write_text(json.dumps(custom,ensure_ascii=False,indent=2))
creator=custom|{'template':'creator-led-v1','videoType':'creator_led','timing':{'intro':3,'demo':4,'outro':3},'media':custom['media']|{'creatorIntro':'inputs/test-fixtures/intro.mp4','creatorVoiceover':'inputs/test-fixtures/voice.wav'},'creator':{'voiceoverStart':3},'subtitles':{'enabled':True,'srt':'inputs/test-fixtures/captions.srt'}}
(R/'configs/examples/creator-led.json').write_text(json.dumps(creator,ensure_ascii=False,indent=2))
print('Created synthetic fixture media; no real people, client media or speech.')
