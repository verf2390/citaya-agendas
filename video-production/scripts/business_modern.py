"""Versioned fullscreen business renderer. Only validated data enters trusted markup.

Media placement is independent of editorial overlays. Video slots retain their
validated timing; bookends hold extracted source frames rather than retime clips.
"""
import html
import shutil

from production import ROOT, MODES, asset, digest, process, write_json


def escape(value):
    return html.escape(str(value), quote=True)


# These are code-owned poses, never configuration or model-provided CSS/JS.
MOTION = {
    'minimal': {'image': (1.02, 1.045), 'video': (1.0, 1.025), 'pan': .3, 'entry': .24},
    'dynamic': {'image': (1.02, 1.08), 'video': (1.0, 1.055), 'pan': .8, 'entry': .20},
    'premium': {'image': (1.025, 1.055), 'video': (1.0, 1.035), 'pan': .4, 'entry': .28},
}


def compile_business_modern(c, ctx, out, mode):
    comp = out / 'composition'
    comp.mkdir()
    inputs = comp / 'assets/inputs'
    inputs.mkdir(parents=True)
    # No internal CITAYA UI or logo is shipped in external compositions.
    for relative in ('vendor/gsap.min.js', 'branding/geist.woff2'):
        dest = comp / 'assets' / relative
        dest.parent.mkdir(exist_ok=True)
        shutil.copy2(ROOT / 'assets' / relative, dest)
    imported = {}

    def media(path, kind):
        path = asset(path, kind)  # defense in depth for local paths and symlinks
        if path not in imported:
            source = ROOT / path
            name = digest(source)[:16] + source.suffix.lower()
            shutil.copy2(source, inputs / name)
            imported[path] = 'assets/inputs/' + name
        return imported[path]

    def bookend(scene, last=False):
        if not scene:
            return None
        if not scene.get('video'):
            return media(scene['media'], 'image')
        path = asset(scene['video'], 'video')
        # Decode the last second and keep its last available frame. Seeking by
        # output fps can miss the final source frame (e.g. 24 fps media / 30 fps
        # export). This extraction never changes the scene's playback window.
        offset = scene.get('videoOffset', 0)
        at = offset + (max(0, scene['duration'] - 1) if last else 0)
        end = offset + (scene['duration'] if last else 0)
        name = f'{digest(ROOT / path)[:16]}-hold-{end:.6f}.png'
        frame_args = ['-t', end - at, '-update', '1'] if last else ['-frames:v', '1']
        process(['ffmpeg', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                 '-ss', f'{at:.6f}', '-i', ROOT / path, *frame_args,
                 '-threads', '1', inputs / name], timeout=60)
        if not (inputs / name).is_file():
            raise RuntimeError('Cannot extract a local video bookend frame.')
        return 'assets/inputs/' + name

    t, brand, content = c['timing'], c['brand'], c.get('content', {})
    duration, settings = sum(t.values()), MODES[mode]
    preset = c['stylePreset']
    pose = MOTION[preset]
    pieces, motions, proof = [], [], []

    def clip(id, start, length, body, cls='', track=2):
        pieces.append(
            f'<section id="{id}" class="clip {cls}" data-start="{start:.6f}" '
            f'data-duration="{length:.6f}" data-track-index="{track}">{body}</section>'
        )

    def background(id, start, length, index, image=None, video=None, offset=0, creator=False):
        motion_id = id + '-motion'
        if video:
            # Non-timed wrapper; the video alone owns its timing.
            pieces.append(
                f'<div id="{motion_id}" class="modern-camera" data-layout-allow-overflow>'
                f'<video id="{id}-video" class="clip modern-media" src="{escape(video)}" '
                f'muted playsinline data-start="{start:.6f}" data-duration="{length:.6f}" '
                f'data-media-start="{offset:.6f}" data-track-index="0"></video></div>'
            )
        else:
            body = (f'<img class="modern-media" src="{escape(image)}" alt="">' if image
                    else '<div class="modern-fallback"></div>')
            clip(id + '-background', start, length,
                 f'<div id="{motion_id}" class="modern-camera" data-layout-allow-overflow>{body}</div>', 'modern-background', 0)
        if (image or video) and not creator:
            low, high = pose['video' if video else 'image']
            direction = 1 if index % 2 == 0 else -1
            # No pan on video; scale starts at 1 so the first frame has no gaps.
            pan = 0 if video else direction * pose['pan']
            motions.append(
                f"tl.fromTo('#{motion_id}',{{scale:{low},xPercent:{-pan}}},"
                f"{{scale:{high},xPercent:{pan},duration:{length},ease:'none'}},{start});"
            )

    def editorial(id, start, length, headline, secondary='', extras='', end=False, creator=False):
        cls = 'modern-editorial' + (' modern-end' if end else '')
        body = '<div class="modern-shade"></div>'
        if not creator:
            body += '<div class="modern-copy">'
            if headline:
                body += f'<h2 class="modern-headline">{escape(headline)}</h2>'
            if secondary:
                body += f'<p class="modern-secondary">{escape(secondary)}</p>'
            body += extras + '</div>'
        clip(id, start, length, body, cls)
        if not creator:
            motions.append(
                f"tl.fromTo('#{id} .modern-copy',{{y:20,opacity:0}},"
                f"{{y:0,opacity:1,duration:{pose['entry']},ease:'power2.out'}},{start});"
            )

    selected = [s for s in c['scenes'] if s.get('video') or s.get('media')]
    creator = c['creator']
    if creator['introVideo']:
        background('creator-intro', 0, t['intro'], 0,
                   video=media(creator['introVideo'], 'video'), offset=creator['introOffset'], creator=True)
        # Keep creator's face clear and defer hook to the first scene.
    else:
        background('hook', 0, t['intro'], 0, image=bookend(selected[0] if selected else None))
        editorial('hook', 0, t['intro'], c['hook'], c['secondaryHook'])
    clock = t['intro']
    for i, scene in enumerate(c['scenes']):
        id, length = f'scene-{i}', scene['duration']
        video = media(scene['video'], 'video') if scene.get('video') else None
        image = media(scene['media'], 'image') if scene.get('media') and not video else None
        background(id, clock, length, i, image=image, video=video, offset=scene.get('videoOffset', 0))
        extras = ''
        labels = content.get('featureLabels', [])
        if labels:
            extras += f'<p class="modern-feature">{escape(labels[i % len(labels)])}</p>'
        offer = ' · '.join(content[k] for k in ('offer', 'price') if content.get(k))
        if offer:
            extras += f'<p class="modern-offer">{escape(offer)}</p>'
        headline = c['hook'] if creator['introVideo'] and i == 0 else scene['headline']
        editorial(id, clock, length, headline, extras=extras)
        proof.append(clock + length * .65)
        clock += length
    if creator['outroVideo']:
        background('outro', clock, t['outro'], len(c['scenes']),
                   video=media(creator['outroVideo'], 'video'), offset=creator['outroOffset'], creator=True)
    else:
        background('outro', clock, t['outro'], len(c['scenes']),
                   image=bookend(selected[-1] if selected else None, last=True))
    contact = ' · '.join(str(brand[k]).removeprefix('https://')
                         for k in ('website', 'socialHandle', 'whatsapp') if brand.get(k))
    extras = f'<p class="modern-cta">{escape(c["cta"])}</p>'
    if contact:
        extras += f'<p class="modern-contact">{escape(contact)}</p>'
    editorial('end', clock, t['outro'], content.get('finalTagline') or brand['businessName'], extras=extras, end=True)
    logo = brand.get('logoLight') or brand.get('logo') or brand.get('logoDark')
    logo_src = media(logo, "image") if logo else None
    if logo_src:
        clip(
            'end-logo',
            clock,
            t['outro'],
            f'<div class="modern-end-logo-wrap"><img class="modern-end-logo" '
            f'src="{escape(logo_src)}" alt="{escape(brand["businessName"])}"></div>',
            'modern-end-branding',
            3,
        )
    branding = (f'<img class="modern-logo" src="{escape(logo_src)}" alt="{escape(brand["businessName"])}">'
                if logo_src else f'<span class="modern-brand-name">{escape(brand["businessName"])}</span>')
    clip('branding', 0, duration, f'<div class="modern-brand">{branding}</div>', 'modern-branding', 4)
    for i, cue in enumerate(ctx['cues']):
        clip(f'caption-{i}', cue['start'], cue['end'] - cue['start'],
             f'<div class="modern-caption">{escape(cue["text"])}</div>', 'modern-captions', 8)
    pieces.append(f'<audio id="master-audio" src="assets/master.wav" data-start="0" '
                  f'data-duration="{duration}" data-volume="1" data-track-index="10"></audio>')
    css = (ROOT / 'templates/business-modern.css').read_text()
    css += f'\nhtml,body{{width:{settings["width"]}px;height:{settings["height"]}px}}.stage{{transform:scale({settings["width"] / 1080})}}'
    classes = 'stage business-modern preset-' + preset + (' with-captions' if ctx['cues'] else '')
    # Only trusted JS. Fit complete copy after the local font loads, never clip
    # claims with line-clamp. This changes layout, not timeline/media playback.
    fit = """document.fonts.ready.then(()=>{
      document.querySelectorAll('.modern-headline,.modern-cta').forEach(el=>{
        let size=parseFloat(getComputedStyle(el).fontSize);
        while(el.scrollHeight>size*1.1*2+2 && size>18){
          size-=1;el.style.fontSize=size+'px';
        }
      });
    });"""
    document = ('<!doctype html><html lang="es"><head><meta charset="utf-8">'
                '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; '
                'script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\';">'
                '<title>Business Modern V2</title><script src="assets/vendor/gsap.min.js"></script><style>' + css + '</style></head><body>')
    document += (f'<div id="root" data-composition-id="business-modern" data-duration="{duration}" '
                 f'data-width="{settings["width"]}" data-height="{settings["height"]}" data-fps="{settings["fps"]}">'
                 f'<div class="{classes}" data-style-preset="{preset}">' + ''.join(pieces) + '</div></div>'
                 '<script>const tl=gsap.timeline({paused:true});' + ''.join(motions)
                 + "window.__timelines['business-modern']=tl;" + fit + '</script></body></html>')
    (comp / 'index.html').write_text(document, encoding='utf-8')
    write_json(comp / 'package.json', {'private': True, 'scripts': {'check': 'hyperframes check', 'render': 'hyperframes render'}, 'devDependencies': {'hyperframes': '0.8.114'}})
    write_json(comp / 'hyperframes.json', {'meta': {'name': 'Business Modern V2'}})
    return comp, [t['intro'] * .6] + proof + [duration - min(.7, t['outro'] / 2)]
