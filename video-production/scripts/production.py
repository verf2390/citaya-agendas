"""Local, deterministic JSON contract and process utilities. No app imports or dotenv."""
from pathlib import Path
from datetime import date
import copy, hashlib, json, math, re, subprocess, shutil
ROOT = Path(__file__).resolve().parents[1]
TYPES = ['product_demo','sales_ad','feature_highlight','niche_specific_ad','website_showcase','before_after','portfolio','educational','roadmap','concept','promotion','service_highlight','appointment_campaign','seasonal_offer','creator_led']
MODES = {'preview': {'width':720,'height':1280,'fps':24,'quality':'draft'}, 'final':{'width':1080,'height':1920,'fps':30,'quality':'delivery'}}
STYLE_PRESETS = ['minimal','dynamic','premium']
class ConfigError(ValueError):
    def __init__(self, code, message): self.code=code; super().__init__(message)
def fail(code, message): raise ConfigError(code,message)
def read_json(path):
    def pairs(items):
        out={}
        for k,v in items:
            if k in out: fail('MALFORMED_CONFIG','Duplicate JSON key.')
            out[k]=v
        return out
    try:
        p=Path(path)
        if p.stat().st_size>100_000: fail('MALFORMED_CONFIG','JSON exceeds 100 KB.')
        return json.loads(p.read_text(encoding='utf-8'),object_pairs_hook=pairs,parse_constant=lambda v:fail('MALFORMED_CONFIG','Non-finite JSON number.'))
    except (OSError,UnicodeError,json.JSONDecodeError) as e: fail('MALFORMED_CONFIG',f'Cannot read valid JSON ({type(e).__name__}).')
def write_json(path,data): Path(path).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def process(args, **kwargs):
    # Only these public runtime settings reach tools; no inherited app secrets.
    env={'PATH':str(Path(shutil.which('node') or '/usr/bin/node').resolve().parent)+':/usr/local/bin:/usr/bin:/bin','HOME':str(Path.home()),'LANG':'C.UTF-8','HYPERFRAMES_NO_TELEMETRY':'1','HYPERFRAMES_NO_UPDATE_CHECK':'1','HYPERFRAMES_NO_AUTO_INSTALL':'1','DO_NOT_TRACK':'1'}
    return subprocess.run([str(a) for a in args],check=True,env=env,**kwargs)
def probe(path):
    try:
        return json.loads(process(['ffprobe','-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',path],capture_output=True,text=True,timeout=30).stdout)
    except (subprocess.SubprocessError,ValueError): fail('INVALID_MEDIA','Media cannot be decoded locally: '+Path(path).name)
def shape(x,keys,at):
    if not isinstance(x,dict): fail('MALFORMED_CONFIG',at+' must be an object.')
    if set(x)-set(keys): fail('UNKNOWN_FIELD',at+': unsupported fields '+', '.join(sorted(set(x)-set(keys))))
def number(x,lo,hi,at):
    if type(x) not in (int,float) or not math.isfinite(x) or not lo<=x<=hi: fail('MALFORMED_CONFIG',f'{at} must be a number in [{lo}, {hi}].')
    return float(x)
def boolean(x,at):
    if type(x) is not bool: fail('MALFORMED_CONFIG',at+' must be boolean.')
    return x
def text(x,limit,at):
    if not isinstance(x,str) or not x.strip() or len(x)>limit or any(ord(c)<32 and c!='\n' for c in x): fail('MALFORMED_CONFIG',f'{at} must be non-empty text, max {limit} characters.')
    if re.search(r'<|>|https?://|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}|\beyJ[a-zA-Z0-9_-]{15,}|-----BEGIN|\b(?:sk|sb_secret)[_-]',x,re.I): fail('UNSAFE_COPY',at+': HTML, links, emails or credential-like strings are not allowed.')
    return x.strip()
def asset(value,kind):
    if value is None: return None
    if not isinstance(value,str): fail('MALFORMED_CONFIG','Media path must be a string or null.')
    rel=Path(value)
    if rel.is_absolute() or '..' in rel.parts or not rel.parts or rel.parts[0] not in ['inputs','assets'] or re.search(r'(secret|credential|certificate|\bcaf\b|\.env|private.dte)',value,re.I): fail('UNSAFE_MEDIA_PATH','Use only local reviewed files under inputs/ or assets/.')
    allowed={'video':{'.mp4','.mov','.webm'},'audio':{'.wav','.mp3','.m4a','.ogg'},'image':{'.png','.jpg','.jpeg','.webp'},'srt':{'.srt'},'vtt':{'.vtt'}}[kind]
    if rel.suffix.lower() not in allowed: fail('INVALID_MEDIA_TYPE',kind+': unsupported file extension.')
    p=(ROOT/rel).resolve()
    if not any(p.is_relative_to((ROOT/d).resolve()) for d in ['inputs','assets']): fail('UNSAFE_MEDIA_PATH','Symlink leaves the approved media directories.')
    if not p.is_file(): fail('MEDIA_NOT_FOUND',f'Optional media was supplied but does not exist: {value}. Use null to select the animated fallback.')
    return str(rel)
def parse_srt(path,duration):
    raw=Path(path).read_text(encoding='utf-8-sig').replace('\r\n','\n')
    if Path(path).suffix.lower()=='.vtt':
        raw=raw.removeprefix('WEBVTT').strip(); blocks=re.split(r'\n\s*\n',raw); converted=[]
        for i,b in enumerate(blocks):
            lines=b.splitlines()
            if not lines or lines[0].startswith('NOTE'):continue
            if '-->' not in lines[0]:lines=lines[1:]
            if not lines:fail('INVALID_SRT','Invalid VTT cue.')
            lines[0]=re.sub(r'(?<![0-9:])(\d{2}:\d{2}\.\d{3})(?![0-9])',r'00:\1',lines[0])
            converted.append(str(i+1)+'\n'+'\n'.join(lines))
        raw='\n\n'.join(converted)
    cues=[];prev=0
    for block in re.split(r'\n\s*\n',raw.strip()):
        lines=block.splitlines()
        if not lines or not lines[0].isdigit() or len(lines)<3: fail('INVALID_SRT','Each cue needs a numeric index, timestamps and text.')
        m=re.fullmatch(r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3}) --> (\d{2}):(\d{2}):(\d{2})[,.](\d{3})',lines[1])
        if not m: fail('INVALID_SRT','Use HH:MM:SS,mmm timestamps.')
        v=list(map(int,m.groups()))
        if any(v[i]>=60 for i in [1,2,5,6]): fail('INVALID_SRT','Invalid minutes/seconds.')
        start=v[0]*3600+v[1]*60+v[2]+v[3]/1000;end=v[4]*3600+v[5]*60+v[6]+v[7]/1000
        if start<prev or end<=start or end>duration: fail('INVALID_SRT','Cues must be ordered, non-overlapping and within the video.')
        words=' '.join(lines[2:]);text(words,84,'subtitle');
        if len(lines[2:])>2 or end-start<.3: fail('INVALID_SRT','Use at most two lines with readable cue duration.')
        cues.append({'start':start,'end':end,'text':words});prev=end
    if not cues: fail('INVALID_SRT','No subtitle cues.')
    return cues

def validate(config,mode='preview'):
    schema_validate(config)
    shape(config,['brand','media','content','mediaPolicy','schemaVersion','product','niche','goal','videoType','template','stylePreset','format','hook','secondaryHook','capabilities','cta','timing','scenes','creator','subtitles','audio','commercialProfile','mediaApproved','project','shareCopy'],'config')
    c=copy.deepcopy(config)
    if c.get('videoType')=='concept': c['videoType']='roadmap'
    expand_inputs(c)
    if c.get('schemaVersion',1)!=1: fail('SCHEMA_VERSION','Only schemaVersion 1 is supported.')
    c['schemaVersion']=1
    catalogs={n:read_json(ROOT/'catalog'/f'{n}.json') for n in ['products','niches','capabilities']}
    products={p['id']:p for p in catalogs['products']['products']};niches={n['id']:n for n in catalogs['niches']['niches']};caps={n['id']:n for n in catalogs['capabilities']['capabilities']}
    for field,options,default in [('product',products,None),('niche',niches,'professional-services'),('videoType',TYPES,'sales_ad'),('format',['vertical'],'vertical')]:
        c[field]=c.get(field,default)
        if not isinstance(c[field],str) or c[field] not in options: fail('INVALID_'+field.upper(),f'{field}: choose a registered value.')
    p=products[c['product']];c['template']=c.get('template',p['defaultTemplate'])
    if c['template'] not in p['allowedTemplates']: fail('INVALID_TEMPLATE','Template is not registered for this product.')
    template=read_json(ROOT/'templates'/c['template']/'template.json')
    defaults={'creator-led-v1':'dynamic','website-showcase-v1':'premium','citaya-websites-vertical-v1':'premium','local-business-promo-v1':'minimal','offer-promo-v1':'dynamic','before-after-v1':'premium'}
    c['stylePreset']=c.get('stylePreset',defaults.get(c['template'],'minimal'))
    if c['stylePreset'] not in STYLE_PRESETS: fail('INVALID_STYLE_PRESET','stylePreset must be minimal, dynamic or premium.')
    c['goal']=text(c.get('goal','lead_generation'),40,'goal')
    c['hook']=text(c.get('hook',niches[c['niche']]['headline']),74,'hook')
    c['secondaryHook']=text(c.get('secondaryHook',p['tagline']),90,'secondaryHook')
    c['cta']=text(c.get('cta',niches[c['niche']]['suggestedCta']),40,'cta')
    if c['videoType']=='roadmap' and re.search(r'prueba|compra|disponible|contrata|reserva|gratis',c['cta'],re.I): fail('ROADMAP_CTA','Roadmap CTA cannot offer unavailable features. Use “Conoce lo que viene”.')
    ids=c.get('capabilities',['provided_business_content'] if c['product']=='custom-client-video' else None)
    c['capabilities']=ids
    if not isinstance(ids,list) or not 1<=len(ids)<=8 or any(not isinstance(i,str) for i in ids) or len(ids)!=len(set(ids)): fail('MALFORMED_CONFIG','capabilities must contain 1–8 unique registered IDs.')
    profile=None
    if c.get('commercialProfile') is not None:
        if not isinstance(c['commercialProfile'],str): fail('MALFORMED_CONFIG','commercialProfile must be a profile ID.')
        profile=next((x for x in read_json(ROOT/'catalog/commercial-profiles.json')['profiles'] if x['id']==c['commercialProfile']),None)
        if not profile: fail('UNKNOWN_COMMERCIAL_PROFILE','No owner-reviewed profile matches this ID.')
        try: valid=date.fromisoformat(profile['reviewDate'])<=date.today()<=date.fromisoformat(profile['expiresOn']) and bool(profile['approvedBy']) and bool(profile['evidenceReference'])
        except (KeyError,TypeError,ValueError): valid=False
        if not valid: fail('EXPIRED_COMMERCIAL_PROFILE','A current, documented owner review is required.')
    checked=[]
    for i in ids:
        if i not in caps: fail('UNKNOWN_CAPABILITY',i+' is not registered.')
        cap=caps[i]
        if cap['status'] not in ['live','demo','in_progress','planned']: fail('INVALID_REGISTRY',i+' has an invalid status.')
        if c['product'] not in [cap['product']]+cap.get('alsoAppliesTo',[]): fail('CAPABILITY_PRODUCT_MISMATCH',i+' does not belong to this product.')
        if c['niche'] not in cap['applicableNiches'] and '*' not in cap['applicableNiches']: fail('CAPABILITY_NICHE_MISMATCH',i+' is not approved for this niche.')
        if c['videoType']!='roadmap':
            if cap['status'] in ['planned','in_progress']: fail('CAPABILITY_NOT_COMMERCIAL',f'{i} is {cap["status"]} and cannot be presented as live.')
            if cap['safeForCommercialVideo'] is not True: fail('CAPABILITY_NOT_COMMERCIAL',i+' is not approved for commercial video.')
            if set(cap.get('requiredGates',[]))-set(profile.get('enabledGates',[]) if profile else []): fail('CAPABILITY_GATE_REQUIRED',i+' needs a current owner-reviewed commercial profile; config cannot enable gates.')
        checked.append({'id':i,'status':cap['status'],'requiredGates':cap.get('requiredGates',[]),'notes':cap['notes']})
    # Obvious future claims cannot bypass the catalog just by moving to free copy.
    copy_values=[c['hook'],c['secondaryHook'],c['cta'],c.get('shareCopy','')]
    forbidden={'clinical_records':r'historia cl[ií]nica|ficha cl[ií]nica|clinical records','odontogram':r'odontograma','customer_migration':r'migraci[oó]n.*(?:excel|encuadrado)','meta_ads':r'meta ads','citaya_cfo':r'citaya cfo','growth_copilot':r'growth copilot','automatic_bhe':r'bhe autom[aá]tica','whatsapp_business_api':r'whatsapp business api'}
    for i,pat in forbidden.items():
        if c['videoType']!='roadmap' and caps[i]['status'] in ['planned','in_progress'] and any(re.search(pat,v,re.I) for v in copy_values if isinstance(v,str)): fail('CAPABILITY_NOT_COMMERCIAL',i+' cannot be claimed in commercial copy.')
    timing=c.setdefault('timing',{});shape(timing,['intro','demo','outro'],'timing')
    for k,d,lo in [('intro',2.8,1.5),('demo',14.4,3),('outro',2.8,2)]: timing[k]=number(timing.get(k,d),lo,60,'timing.'+k)
    duration=sum(timing.values())
    if duration>120: fail('INVALID_TIMING','Total duration must not exceed 120 seconds.')
    scenes=c.get('scenes',[{'capability':i} for i in ids])
    if not isinstance(scenes,list) or not 1<=len(scenes)<=12: fail('INVALID_SCENES','Use 1–12 scenes.')
    for s in scenes:
        shape(s,['capability','mode','headline','duration','media','video','beforeMedia','afterMedia'],'scene')
        if s.get('capability') not in ids: fail('UNVALIDATED_SCENE','Every scene must reference a selected capability.')
        cap=caps[s['capability']];s['mode']=s.get('mode',cap['suggestedScenes'][0])
        if s['mode'] not in template['sceneModes']: fail('INVALID_SCENE_MODE','Unsupported scene mode for template.')
        # No cross-feature visual: e.g. clinical record claim cannot hide under a calendar capability.
        if s['mode'] not in cap['suggestedScenes']+['benefit','media'] and not (s['mode']=='before_after' and template['renderer']=='website'): fail('SCENE_CAPABILITY_MISMATCH','Scene mode does not illustrate this capability.')
        s['headline']=text(s.get('headline',cap['suggestedBenefits'][0] if len(cap['suggestedBenefits'][0])<=64 else cap['name']),64,'scene.headline')
        s['duration']=number(s.get('duration',timing['demo']/len(scenes)),1.4,30,'scene.duration')
        for key in ['media','beforeMedia','afterMedia']: s[key]=asset(s.get(key),'image')
        s['video']=asset(s.get('video'),'video')
        if s['video'] and float(probe(ROOT/s['video'])['format']['duration'])+.04<s['duration']: fail('MEDIA_DURATION','Scene video is shorter than its scene.')
        if s['mode']=='before_after' and bool(s['beforeMedia'])!=bool(s['afterMedia']): fail('BEFORE_AFTER_PAIR','Provide both beforeMedia and afterMedia or neither for a labeled concept.')
    if abs(sum(s['duration'] for s in scenes)-timing['demo'])>.001: fail('INVALID_TIMING','Scene durations must sum to timing.demo.')
    if set(ids)-{s['capability'] for s in scenes}: fail('MISSING_CAPABILITY_SCENE','Every selected capability must have a scene.')
    c['scenes']=scenes
    creator=c.setdefault('creator',{});shape(creator,['introVideo','outroVideo','voiceover','voiceoverStart','introOffset','outroOffset','useClipAudio'],'creator')
    media=[];speech=[]
    creator['useClipAudio']=boolean(creator.get('useClipAudio',True),'creator.useClipAudio')
    for k in ['introVideo','outroVideo','voiceover']:
        creator[k]=asset(creator.get(k),'audio' if k=='voiceover' else 'video')
        if creator[k]: media.append(creator[k])
    for k in ['voiceoverStart','introOffset','outroOffset']: creator[k]=number(creator.get(k,0),0,duration,'creator.'+k)
    for key,slot,start,offset in [('introVideo',timing['intro'],0,creator['introOffset']),('outroVideo',timing['outro'],timing['intro']+timing['demo'],creator['outroOffset']),('voiceover',None,creator['voiceoverStart'],0)]:
        if not creator[key]: continue
        info=probe(ROOT/creator[key]);streams=info['streams'];actual=float(info['format']['duration']);has_audio=any(s['codec_type']=='audio' for s in streams)
        if key!='voiceover' and not any(s['codec_type']=='video' for s in streams): fail('INVALID_MEDIA','Creator video must contain video.')
        if key=='voiceover' and not has_audio: fail('INVALID_MEDIA','Voiceover must contain audio.')
        length=actual if slot is None else slot
        if actual+.04<length+offset or start+length>duration+.04: fail('MEDIA_DURATION','Creator clip/voice does not fit its configured timeline slot.')
        if has_audio and (key=='voiceover' or creator['useClipAudio']): speech.append({'path':creator[key],'start':start,'duration':length,'offset':offset})
    # Accidental double narration is almost always a production mistake.
    speech.sort(key=lambda x:x['start'])
    if any(a['start']+a['duration']>b['start']+.04 for a,b in zip(speech,speech[1:])): fail('OVERLAPPING_SPEECH','Voiceover overlaps creator audio. Change voiceoverStart or useClipAudio.')
    subtitles=c.setdefault('subtitles',{});shape(subtitles,['enabled','srt','vtt'],'subtitles');subtitles['enabled']=boolean(subtitles.get('enabled',False),'subtitles.enabled');subtitles['srt']=asset(subtitles.get('srt'),'srt');subtitles['vtt']=asset(subtitles.get('vtt'),'vtt')
    if subtitles['srt'] and subtitles['vtt']:fail('MALFORMED_CONFIG','Choose SRT or VTT, not both.')
    captions=subtitles['srt'] or subtitles['vtt']
    if subtitles['enabled'] and not captions: fail('MISSING_SRT','Enabled subtitles require a local SRT file.')
    cues=parse_srt(ROOT/captions,duration) if subtitles['enabled'] else []
    if captions:media.append(captions)
    audio=c.setdefault('audio',{});shape(audio,['music','sfx','duckMusicDuringVoice'],'audio')
    for k in ['music','sfx','duckMusicDuringVoice']:audio[k]=boolean(audio.get(k,True),'audio.'+k)
    if speech and audio['music'] and not audio['duckMusicDuringVoice']: fail('VOICE_DUCKING_REQUIRED','Music under speech requires duckMusicDuringVoice=true.')
    project=c.setdefault('project',{});shape(project,['name','category'],'project');project['name']=text(project.get('name','Estudio Demo' if c['niche']=='architecture' else 'Negocio Demo'),32,'project.name');project['category']=text(project.get('category',niches[c['niche']]['name']),35,'project.category')
    for s in scenes:
        media.extend(s[k] for k in ['media','video','beforeMedia','afterMedia'] if s[k])
        for i,pat in forbidden.items():
            if c['videoType']!='roadmap' and caps[i]['status'] in ['planned','in_progress'] and re.search(pat,s['headline'],re.I):fail('CAPABILITY_NOT_COMMERCIAL',i+' cannot be claimed in scene copy.')
    media.extend(validate_media_inputs(c))
    for mp in sorted(set(media)):
        if Path(mp).suffix.lower() not in ['.srt','.vtt']:inspect_media(ROOT/mp)
    c['mediaApproved']=boolean(c.get('mediaApproved',False),'mediaApproved')
    if media and not c['mediaApproved']: fail('MEDIA_REVIEW_REQUIRED','Set mediaApproved=true only after reviewing supplied media and captions for rights and private data.')
    c['shareCopy']=text(c.get('shareCopy',f'{c["hook"]} {c["secondaryHook"]} {c["cta"]}'),320,'shareCopy')
    if c['videoType']=='roadmap' and not c['shareCopy'].startswith('Concepto / hoja de ruta.'):c['shareCopy']='Concepto / hoja de ruta. Las funciones planificadas no están disponibles. '+c['shareCopy']
    report={'valid':True,'schemaVersion':1,'mode':mode,'duration':round(duration,6),'resolution':MODES[mode],'stylePreset':c['stylePreset'],'capabilities':checked,'warnings':['Copy and supplied media still require human factual/privacy review; validation is not semantic or biometric inspection.'],'catalogSha256':{n:digest(ROOT/'catalog'/f'{n}.json') for n in catalogs},'mediaSha256':{m:digest(ROOT/m) for m in sorted(set(media))},'productionDataAccess':False}
    return c,report,{'product':p,'niche':niches[c['niche']],'caps':caps,'template':template,'speech':speech,'cues':cues}

def schema_validate(c):
    from jsonschema import Draft202012Validator
    schema=read_json(ROOT/'schemas/video-config.schema.json')
    errors=sorted(Draft202012Validator(schema).iter_errors(c),key=lambda e:str(list(e.path)))
    if errors:fail('SCHEMA_VALIDATION',str(list(errors[0].path))+': '+'invalid '+str(errors[0].validator)+' rule')

def expand_inputs(c):
    """Translate the public media/content vocabulary to the stable V2 engine contract."""
    content=c.get('content',{});m=c.get('media',{});creator=c.setdefault('creator',{})
    for k in ['hook','secondaryHook','cta']:
        if content.get(k):
            if c.get(k) and c[k]!=content[k]:fail('AMBIGUOUS_CONFIG','Conflicting '+k+' fields.')
            c[k]=content[k]
    for src,dst in [('creatorIntro','introVideo'),('creatorOutro','outroVideo')]:
        if m.get(src):
            if creator.get(dst) and creator[dst]!=m[src]:fail('AMBIGUOUS_CONFIG','Conflicting creator media.')
            creator[dst]=m[src]
    voices=[m[k] for k in ['clientVoiceover','creatorVoiceover'] if m.get(k)]
    if len(voices)>1:fail('OVERLAPPING_SPEECH','Choose clientVoiceover or creatorVoiceover for the initial implementation.')
    if voices:
        if creator.get('voiceover') and creator['voiceover']!=voices[0]:fail('AMBIGUOUS_CONFIG','Conflicting voiceover.')
        creator['voiceover']=voices[0]
    if 'scenes' not in c and c.get('product')=='custom-client-video':
        assets=[{'media':x} for x in m.get('images',[])+m.get('screenshots',[]) if x]+[{'video':x} for x in m.get('videos',[]) if x]
        if not assets:assets=[{}]
        c['scenes']=[{'capability':'provided_business_content','mode':'media' if item else 'benefit','headline':content.get('benefit') or content.get('offer') or 'Conoce nuestro trabajo.',**item} for item in assets]
    c.setdefault('mediaPolicy',{'useOnlyProvidedAssets':True,'allowStockMedia':False,'allowGeneratedMedia':False})
    for k,d in [('useOnlyProvidedAssets',True),('allowStockMedia',False),('allowGeneratedMedia',False)]:c['mediaPolicy'][k]=boolean(c['mediaPolicy'].get(k,d),'mediaPolicy.'+k)
    if c['mediaPolicy']['allowStockMedia'] or c['mediaPolicy']['allowGeneratedMedia']:fail('MEDIA_POLICY_UNSUPPORTED','Stock search and media generation are not installed. Use reviewed provided assets.')
    if c.get('product')=='custom-client-video':
        if not c.get('brand',{}).get('businessName'):fail('MISSING_BRAND','Client videos require brand.businessName.')
        if not c['mediaPolicy']['useOnlyProvidedAssets']:fail('MEDIA_POLICY','Client videos must use only provided assets.')
        for scene in c['scenes']:
            if scene.get('mode') not in ['benefit','media','before_after'] and not scene.get('media'):fail('PROVIDED_MEDIA_REQUIRED','Client website scenes require a supplied screenshot; no invented business imagery.')
            if scene.get('mode')=='before_after' and not (scene.get('beforeMedia') and scene.get('afterMedia')):fail('PROVIDED_MEDIA_REQUIRED','Client before/after requires both reviewed images.')

def validate_media_inputs(c):
    found=[]
    for k in ['logo','logoLight','logoDark']:
        value=c.get('brand',{}).get(k)
        if value: c['brand'][k]=asset(value,'image');found.append(value)
    for k,values in c.get('media',{}).items():
        kind='image' if k in ['images','screenshots'] else 'video' if k in ['videos','creatorIntro','creatorOutro'] else 'audio'
        for v in (values if isinstance(values,list) else [values]):
            if v:asset(v,kind);found.append(v)
    for k in ['businessName']:
        if c.get('brand',{}).get(k):text(c['brand'][k],45,'brand.'+k)
    if c.get('brand',{}).get('website'):
        from urllib.parse import urlsplit
        u=urlsplit(c['brand']['website'])
        if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment:fail('UNSAFE_PUBLIC_URL','Use a public HTTPS address without credentials, query strings or fragments.')
    for k,v in c.get('content',{}).items():
        for item in (v if isinstance(v,list) else [v]):
            if item:text(item,90,'content.'+k)
    if c.get('content',{}).get('price') and not c['content'].get('offer'):fail('PRICE_WITHOUT_OFFER','A price needs an explicit reviewed offer.')
    for p in found:
        inspect_media(ROOT/p)
    return found

def inspect_media(path):
    p=Path(path);ext=p.suffix.lower()
    info=probe(p);streams=info.get('streams',[])
    if not streams:fail('INVALID_MEDIA','No media stream found.')
    kind='image' if ext in ['.png','.jpg','.jpeg','.webp'] else 'video' if ext in ['.mp4','.mov','.webm'] else 'audio'
    if kind=='image':
        with p.open('rb') as stream:header=stream.read(16)
        if not (header.startswith(b'\x89PNG\r\n\x1a\n') or header.startswith(b'\xff\xd8\xff') or header[:4]==b'RIFF' and header[8:12]==b'WEBP'):fail('INVALID_MEDIA_TYPE','Raster content does not match an allowed image.')
    s=next((s for s in streams if s['codec_type']==('audio' if kind=='audio' else 'video')),None)
    if s is None:fail('INVALID_MEDIA_TYPE','File content does not match declared media type.')
    if s.get('width',0)*s.get('height',0)>40_000_000:fail('MEDIA_SAFETY_LIMIT','Image exceeds decoder safety pixel limit (40 MP).')
    return {'type':kind,'bytes':p.stat().st_size,'durationMs':round(float(info.get('format',{}).get('duration',0))*1000),'width':s.get('width'),'height':s.get('height'),'codec':s.get('codec_name'),'sha256':digest(p)}

def tenant_schema_validate(c):
    from jsonschema import Draft202012Validator
    errors=list(Draft202012Validator(read_json(ROOT/'schemas/tenant-video-config.schema.json')).iter_errors(c))
    if errors:fail('TENANT_SCHEMA_VALIDATION',str(list(errors[0].path))+': '+'invalid '+str(errors[0].validator)+' rule')
