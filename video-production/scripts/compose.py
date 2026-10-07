"""V2-derived scene/timeline compiler; configurations never contain JS or shell."""
from pathlib import Path
import html,json,shutil
from production import ROOT,MODES,digest,write_json
E=lambda s:html.escape(str(s),quote=True)
UI={'service':'service','professional':'professional','date':'date','confirmed':'confirm-selected','calendar':'calendar-selected','customers':'customers-selected','reminder':'reminder-selected'}
STATUS={'live':'Disponible','demo':'Demo · No implica disponibilidad','in_progress':'En desarrollo · No disponible','planned':'Planificado · No disponible'}
def compile_composition(c,ctx,out,mode):
    comp=out/'composition';comp.mkdir();shutil.copytree(ROOT/'assets',comp/'assets')
    imported={}
    def media(path):
        if not path:return None
        if path not in imported:
            src=ROOT/path;name=digest(src)[:16]+src.suffix.lower();dest=comp/'assets'/'inputs'/name;dest.parent.mkdir(exist_ok=True);shutil.copy2(src,dest);imported[path]='assets/inputs/'+name
        return imported[path]
    brand=c.get('brand',{});custom=c['product']=='custom-client-video';content=c.get('content',{});
    t=c['timing'];duration=sum(t.values());r=MODES[mode];scale=r['width']/1080
    css=(ROOT/'templates/citaya-saas-vertical-v1/layout.css').read_text()
    css+='\n'+(ROOT/'templates/presets.css').read_text()
    if ctx['template']['renderer']=='website':css+='\n'+(ROOT/'templates/citaya-websites-vertical-v1/layout.css').read_text()
    css+=f'\nhtml,body{{width:{r["width"]}px;height:{r["height"]}px}}.stage{{transform:scale({scale})}}'
    pieces=[];motions=[];proof=[]
    if brand.get('primaryColor'):css+=f'\n.fill{{background:{brand["primaryColor"]}}}.screen{{border-color:{brand["primaryColor"]}}}'
    if brand.get('secondaryColor'):css+=f'\n.screen{{background:{brand["secondaryColor"]}}}'
    def clip(id,start,length,content,cls='',track=2):
        pieces.append(f'<section id="{id}" class="clip {cls}" data-start="{start:.6f}" data-duration="{length:.6f}" data-track-index="{track}">{content}</section>')
    def enter(id,start):
        motions.append(f"tl.fromTo('#{id} .screen-motion',{{scale:1.055,y:16,opacity:0}},{{scale:1,y:0,opacity:1,duration:.28,ease:'power3.out'}},{start});tl.fromTo('#{id} .headline',{{x:23,opacity:0}},{{x:0,opacity:1,duration:.22,ease:'power2.out'}},{start});")
    branding=f'<img class="brand" src="assets/branding/citaya-logo.svg" alt="Citaya"><div class="product-name">{E(ctx["product"]["name"])}</div><div class="niche">{E(ctx["niche"]["name"])}</div>'
    if custom:
        logo=brand.get('logoDark') or brand.get('logo') or brand.get('logoLight')
        branding=(f'<img class="brand" src="{media(logo)}" alt="Logo aprobado" style="object-fit:contain;background:white;border-radius:16px">' if logo else '')+f'<div class="product-name">{E(brand["businessName"])}</div><div class="niche">{E(c["project"]["category"])}</div>'
    if c['creator']['introVideo']:css+='\n.product-name,.niche{background:white;padding:12px;border-radius:12px}.brand{background:white;border-radius:14px}.demo{background:white;padding:6px}'
    clip('brand-chrome',0,duration-t['outro'],branding+'<div class="demo">Demostración · Datos ficticios / material revisado</div><div class="progress" data-layout-ignore><div class="fill"></div></div>',track=1)
    if c['creator']['introVideo']:
        p=media(c['creator']['introVideo']);offset=c['creator']['introOffset']
        pieces.append(f'<video id="creator-intro" class="clip creator-video" src="{p}" muted playsinline data-start="0" data-duration="{t["intro"]}" data-media-start="{offset}" data-track-index="0"></video>')
    else:
        clip('hook',0,t['intro'],f'<h1 class="headline hook">{E(c["hook"])}</h1><p class="secondary">{E(c["secondaryHook"])}</p>')
        motions.append("tl.fromTo('#hook .headline',{x:-28,opacity:0},{x:0,opacity:1,duration:.2,ease:'power3.out'},0);tl.fromTo('#hook .secondary',{y:25,opacity:0},{y:0,opacity:1,duration:.23,ease:'power3.out'},.12);")
    def website(s):
        m=s['mode'];name=E(c['project']['name']);category=E(c['project']['category'])
        if s['media']:return f'<img src="{media(s["media"])}" alt="Material de proyecto revisado">'
        if m=='before_after':
            if s['beforeMedia']:
                return '<div class="comparison">'+''.join(f'<div><span class="compare-label">{label}</span><img src="{media(s[key])}" alt="{label}"></div>' for label,key in [('Antes','beforeMedia'),('Después','afterMedia')])+'</div>'
            return '<div class="comparison"><div><span class="compare-label">Antes · Concepto</span><p>Información sin jerarquía</p><p class="muted">Un ejemplo ficticio de estructura.</p></div><div><span class="compare-label">Después · Concepto</span><p>Servicios, proyectos y contacto</p><p class="muted">Una propuesta visual de demostración.</p></div></div>'
        body=f'<div class="web-brand">{name}</div>'
        if m in ['desktop','mobile','homepage']:
            body+=f'<div class="web-kicker">{category}</div><h3 class="web-title">Ideas que toman forma.</h3><div class="web-art" aria-hidden="true"></div><div class="web-button">Conoce nuestro trabajo</div>'
        elif m=='portfolio':body+='<h3 class="web-title">Proyectos</h3><div class="web-art" aria-hidden="true"></div><div class="project-tile">Proyecto de demostración</div><p class="web-desc">Una galería para presentar tu trabajo.</p>'
        elif m=='services':body+='<h3 class="web-title">Servicios</h3><div class="web-services"><div class="web-service">01 · Asesoría</div><div class="web-service">02 · Diseño</div><div class="web-service">03 · Desarrollo</div></div>'
        elif m=='about':body+='<h3 class="web-title">Nuestro enfoque</h3><p class="web-desc">Un espacio para explicar cómo trabaja tu equipo.</p><div class="web-art" aria-hidden="true"></div>'
        elif m=='contact':body+='<h3 class="web-title">Conversemos</h3><div class="form-field">Nombre · Campo de ejemplo</div><div class="form-field">Correo · Sin datos reales</div><div class="form-field">Cuéntanos tu proyecto</div><div class="web-button">Enviar consulta</div><p class="web-proof">Formulario visual · No envía mensajes</p>'
        else:return benefit(s)
        return f'<div class="browser"><div class="browser-top">● ● ● <span>Vista de demostración</span></div><div class="web-content">{body}</div></div>'
    def niche_demo(mode):
        if c['niche']!='barber': return None
        header='<div class="niche-demo-head"><span>CY</span><strong>Barbería Demo</strong><small>Reserva online · Datos ficticios</small></div>'
        if mode=='service':
            body='<h3>Elige un servicio</h3><div class="niche-demo-list"><div class="niche-demo-option is-selected"><b>Corte</b><span>Seleccionado</span></div><div class="niche-demo-option"><b>Barba</b><span>Disponible</span></div><div class="niche-demo-option"><b>Corte + barba</b><span>Disponible</span></div></div>'
        elif mode=='professional':
            body='<h3>Elige profesional</h3><div class="niche-demo-list"><div class="niche-demo-option is-selected"><b>Barbero A</b><span>Seleccionado</span></div><div class="niche-demo-option"><b>Barbero B</b><span>Disponible</span></div></div>'
        elif mode=='date':
            body='<h3>Elige fecha y hora</h3><div class="niche-demo-days"><span>Lun 05</span><span class="is-selected">Mar 06</span><span>Mié 07</span></div><div class="niche-demo-times"><span>10:00</span><span class="is-selected">11:30</span><span>13:00</span><span>16:30</span></div>'
        else:
            return None
        return '<div class="niche-demo">'+header+'<div class="niche-demo-body">'+body+'</div></div>'

    def benefit(s):
        cap=ctx['caps'][s['capability']]
        badge='Simulación · Sin envío' if s['mode']=='campaign-preview' else STATUS[cap['status']]
        if c['videoType']=='roadmap' and cap['status'] in ['planned','in_progress']:badge=STATUS[cap['status']]
        if custom:
            details=[content.get(k) for k in ['benefit','offer','price'] if content.get(k)]+content.get('featureLabels',[])
            return '<div class="benefit-card"><span class="status">'+E(brand['businessName'])+'</span>'+''.join('<p>'+E(x)+'</p>' for x in details[:4])+'<h3>'+E(c['cta'])+'</h3></div>'
        return f'<div class="benefit-card"><span class="status">{E(badge)}</span><h3>{E(cap["name"])}</h3><p>{E(cap["shortDescription"])}</p><p class="small">{E(cap["commercialQualifier"] or ("Concepto ilustrativo" if c["videoType"]=="roadmap" else "Demostración con información ficticia"))}</p></div>'
    clock=t['intro']
    for i,s in enumerate(c['scenes']):
        id=f'scene-{i}';m=s['mode'];cap=ctx['caps'][s['capability']]
        if s.get('video'):
            body=''
            vp=media(s['video']);pieces.append(f'<video id="scene-video-{i}" class="clip creator-video" src="{vp}" muted playsinline data-start="{clock}" data-duration="{s["duration"]}" data-track-index="0"></video>')
        elif ctx['template']['renderer']=='website':body=website(s)
        elif s['media']:body=f'<img src="{media(s["media"])}" alt="Material revisado">'
        elif m in UI:
            demo=niche_demo(m)
            if demo:
                body=demo
                motions.append(f"tl.fromTo('#{id} .niche-demo .is-selected',{{scale:.985,opacity:.75}},{{scale:1,opacity:1,duration:.16,ease:'power2.out'}},{clock+min(.55,s['duration']*.3)});")
            else:
                src=UI[m];body=f'<img src="assets/ui/{src}.png" alt="Interfaz Citaya con datos ficticios">'
                if m in ['service','professional','date']:
                    body+=f'<img id="{id}-selected" class="state" src="assets/ui/{src}-selected.png" alt="Selección ficticia">'
                    motions.append(f"tl.fromTo('#{id}-selected',{{opacity:0}},{{opacity:1,duration:.12,ease:'none'}},{clock+min(.65,s['duration']*.35)});")
        else:body=benefit(s)
        qualifier=f'<div class="qualifier">{E(cap["commercialQualifier"])}</div>' if cap['requiredGates'] and c['videoType']!='roadmap' else ''
        if c['videoType']=='roadmap':qualifier=f'<div class="qualifier">{E(STATUS[cap["status"]])}</div>'
        elif cap['status']=='demo':qualifier='<div class="qualifier">Demo · No implica disponibilidad comercial</div>'
        scene_headline=c['hook'] if c['creator']['introVideo'] and i==0 else s['headline']
        clip(id,clock,s['duration'],f'<h2 class="headline">{E(scene_headline)}</h2><div class="screen {"website-screen " if ctx["template"]["renderer"]=="website" else ""}{m}"><div class="screen-motion" data-layout-allow-overflow>{body}</div></div>{qualifier}')
        if s.get('video'):css+=f'\n#{id} .screen{{display:none}}#{id} .headline{{background:#ecf2f8;padding:25px;border-radius:20px}}'
        if custom and content.get('offer'):
            offer=content['offer']+(' · '+content['price'] if content.get('price') else '')
            clip(id+'-offer',clock,s['duration'],f'<div style="position:absolute;left:100px;top:1440px;width:880px;background:#0f172a;color:white;padding:28px;border-radius:20px;font-size:39px">{E(offer)}</div>',track=4)
        elif custom and content.get('featureLabels'):
            label=content['featureLabels'][i%len(content['featureLabels'])]
            clip(id+'-feature',clock,s['duration'],f'<div style="position:absolute;left:100px;top:1510px;width:880px;background:#0f172a;color:white;padding:25px;border-radius:18px;font-size:38px">{E(label)}</div>',track=4)
        enter(id,clock)
        if m=='calendar':motions.append(f"tl.to('#{id} .screen-motion',{{scale:1.035,y:-8,duration:{max(.1,s['duration']-.5)},ease:'power1.inOut'}},{clock+.4});")
        proof.append(clock+s['duration']*.65);clock+=s['duration']
    if c['creator']['outroVideo']:
        p=media(c['creator']['outroVideo']);offset=c['creator']['outroOffset']
        pieces.append(f'<video id="creator-outro" class="clip creator-video" src="{p}" muted playsinline data-start="{clock}" data-duration="{t["outro"]}" data-media-start="{offset}" data-track-index="0"></video>')
        clip('end',clock,t['outro'],f'<div class="creator-outro-title">{E(ctx["product"]["name"])}<p>{E(ctx["product"]["tagline"])}</p></div><div class="creator-outro-cta">{E(c["cta"])}</div>')
    else:
        title='Ideas para lo que viene' if c['videoType']=='roadmap' else content.get('finalTagline') or (brand['businessName'] if custom else ctx['product']['tagline'])
        clip('end',clock,t['outro'],f'<div class="end-logo">{E(brand['businessName']) if custom else ('CITAYA WEB' if ctx['template']['renderer']=='website' else 'CITAYA')}</div><h2 class="end-title">{E(title)}</h2><div class="end-cta">{E(c["cta"])}</div>','end',3)
        motions.append(f"tl.fromTo('#end .end-logo',{{scale:.9,opacity:0}},{{scale:1,opacity:1,duration:.2,ease:'power3.out'}},{clock+.05});tl.fromTo('#end .end-title,#end .end-cta',{{y:26,opacity:0}},{{y:0,opacity:1,duration:.24,ease:'power3.out'}},{clock+.04});")
    contact=' · '.join(str(brand[k]).removeprefix('https://') for k in ['website','socialHandle','whatsapp'] if brand.get(k))
    if custom and contact:clip('public-contact',duration-t['outro'],t['outro'],f'<div style="position:absolute;left:85px;top:1500px;width:910px;color:#f8fafc;background:#0f172a;padding:20px;border-radius:16px;font-size:30px;text-align:center">{E(contact)}</div>',track=5)
    if c['videoType']=='roadmap':clip('truth-banner',0,duration,'<div class="truth-bar">HOJA DE RUTA · Conceptos, no promesa de disponibilidad</div>',track=7)
    for i,cue in enumerate(ctx['cues']):clip(f'caption-{i}',cue['start'],cue['end']-cue['start'],f'<div class="subtitle">{E(cue["text"])}</div>',track=8)
    motions.append(f"tl.fromTo('.fill',{{scaleX:0}},{{scaleX:1,duration:{duration},ease:'none'}},0);")
    # A pre-mixed local track provides identical voice/ducking in preview and export.
    pieces.append(f'<audio id="master-audio" src="assets/master.wav" data-start="0" data-duration="{duration}" data-volume="1" data-track-index="10"></audio>')
    document='<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\';"><title>Citaya Production</title><script src="assets/vendor/gsap.min.js"></script><style>'+css+'</style></head><body>'
    stage_classes='stage preset-'+c['stylePreset']+(' with-captions' if ctx['cues'] else '')
    document+=f'<div id="root" data-composition-id="citaya-production" data-start="0" data-duration="{duration}" data-width="{r["width"]}" data-height="{r["height"]}" data-fps="{r["fps"]}"><div class="{stage_classes}" data-style-preset="{c["stylePreset"]}">'+''.join(pieces)+'</div></div><script>const tl=gsap.timeline({paused:true});'+''.join(motions)+"window.__timelines['citaya-production']=tl;</script></body></html>"
    (comp/'index.html').write_text(document,encoding='utf-8')
    write_json(comp/'package.json',{'private':True,'scripts':{'check':'hyperframes check','render':'hyperframes render'},'devDependencies':{'hyperframes':'0.8.114'}})
    write_json(comp/'hyperframes.json',{'meta':{'name':'Citaya reusable production'}})
    return comp,[t['intro']*.6]+proof+[duration-min(.7,t['outro']/2)]
