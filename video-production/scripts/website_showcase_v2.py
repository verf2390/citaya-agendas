"""Editorial website-showcase renderer.

The AI chooses reviewed media, copy and timing. This renderer owns the visual
language: complete horizontal website views inside a vertical editorial frame,
with deterministic motion and no crop/zoom of client media.
"""
import html
import shutil

from production import ROOT, MODES, asset, digest, process, write_json
from business_modern import bookend_frame_name


def escape(value):
    return html.escape(str(value), quote=True)


def compile_website_showcase_v2(c, ctx, out, mode):
    comp = out / 'composition'
    comp.mkdir()
    inputs = comp / 'assets' / 'inputs'
    inputs.mkdir(parents=True)

    # External showcases only need local runtime assets. Never ship internal
    # CITAYA product UI into a client-media composition.
    for relative in ('vendor/gsap.min.js', 'branding/geist.woff2'):
        dest = comp / 'assets' / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / 'assets' / relative, dest)

    imported = {}

    def media(path, kind):
        path = asset(path, kind)
        if path not in imported:
            source = ROOT / path
            name = digest(source)[:16] + source.suffix.lower()
            shutil.copy2(source, inputs / name)
            imported[path] = 'assets/inputs/' + name
        return imported[path]

    def hold(scene, last=False):
        """Return a real still from reviewed scene media without retiming it."""
        if not scene:
            return None
        if scene.get('media'):
            return media(scene['media'], 'image')
        if not scene.get('video'):
            return None
        path = asset(scene['video'], 'video')
        source = ROOT / path
        offset = scene.get('videoOffset', 0)
        at = offset + (max(0, scene['duration'] - 1) if last else 0)
        end = offset + (scene['duration'] if last else 0)
        name = bookend_frame_name(digest(source), offset, scene['duration'], last)
        dest = inputs / name
        args = ['-t', end - at, '-update', '1'] if last else ['-frames:v', '1']
        process([
            'ffmpeg', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe',
            '-ss', f'{at:.6f}', '-i', source, *args, '-threads', '1', dest,
        ], timeout=60)
        if not dest.is_file():
            raise RuntimeError('Cannot extract a local website showcase frame.')
        return 'assets/inputs/' + name

    timing = c['timing']
    duration = sum(timing.values())
    settings = MODES[mode]
    content = c.get('content', {})
    brand = c['brand']
    creator = c['creator']
    scenes = c['scenes']
    selected = [scene for scene in scenes if scene.get('media') or scene.get('video')]
    accent = brand.get('primaryColor') or '#9b4b2f'
    pieces, motions, proof = [], [], []

    def clip(id, start, length, body, cls='', track=2):
        pieces.append(
            f'<section id="{id}" class="clip {cls}" data-start="{start:.6f}" '
            f'data-duration="{length:.6f}" data-track-index="{track}">{body}</section>'
        )

    def visual(id, start, length, scene=None, still=None):
        """Place complete website media inside the editorial browser frame."""
        clip(
            id + '-frame',
            start,
            length,
            '<div class="showcase-frame-shell"><div class="showcase-frame-dot"></div></div>',
            'showcase-frame-layer',
            0,
        )
        if still:
            clip(
                id + '-media',
                start,
                length,
                f'<img class="website-visual" src="{escape(still)}" alt="Material web revisado">',
                'showcase-media-layer',
                1,
            )
        elif scene and scene.get('video'):
            src = media(scene['video'], 'video')
            pieces.append(
                f'<video id="{id}-media" class="clip website-visual showcase-video" '
                f'src="{escape(src)}" muted playsinline data-start="{start:.6f}" '
                f'data-duration="{length:.6f}" '
                f'data-media-start="{scene.get("videoOffset", 0):.6f}" '
                f'data-track-index="1"></video>'
            )
        elif scene and scene.get('media'):
            src = media(scene['media'], 'image')
            clip(
                id + '-media',
                start,
                length,
                f'<img class="website-visual" src="{escape(src)}" alt="Material web revisado">',
                'showcase-media-layer',
                1,
            )
        motions.append(
            f"tl.fromTo('#{id}-frame',{{y:18,opacity:0}},"
            f"{{y:0,opacity:1,duration:.24,ease:'power2.out'}},{start});"
            f"tl.fromTo('#{id}-media',{{opacity:0}},"
            f"{{opacity:1,duration:.20,ease:'none'}},{start});"
        )

    def copy_layer(id, start, length, headline, secondary='', kicker='', end=False):
        classes = 'showcase-copy-wrap' + (' showcase-end-copy' if end else '')
        body = f'<div class="{classes}">'
        if kicker:
            body += f'<div class="showcase-kicker">{escape(kicker)}</div>'
        if headline:
            body += f'<h2 class="showcase-headline">{escape(headline)}</h2>'
        if secondary:
            body += f'<p class="showcase-secondary">{escape(secondary)}</p>'
        if end:
            body += f'<div class="showcase-cta">{escape(c["cta"])}</div>'
            contact = ' · '.join(
                str(brand[key]).removeprefix('https://')
                for key in ('website', 'socialHandle', 'whatsapp')
                if brand.get(key)
            )
            if contact:
                body += f'<div class="showcase-contact">{escape(contact)}</div>'
        body += '</div>'
        clip(id, start, length, body, 'showcase-editorial', 3)
        motions.append(
            f"tl.fromTo('#{id} .showcase-copy-wrap',{{y:20,opacity:0}},"
            f"{{y:0,opacity:1,duration:.26,ease:'power2.out'}},{start});"
        )

    category = str(c.get('project', {}).get('category') or '').strip()
    brandline = brand['businessName'] + ((' · ' + category) if category else '')
    clip(
        'showcase-branding',
        0,
        duration,
        f'<div class="showcase-brandline">{escape(brandline)}</div>'
        '<div class="showcase-rule"></div>',
        'showcase-branding',
        5,
    )

    if creator.get('introVideo'):
        intro_src = media(creator['introVideo'], 'video')
        pieces.append(
            f'<video id="creator-intro" class="clip creator-showcase-video" '
            f'src="{escape(intro_src)}" muted playsinline data-start="0" '
            f'data-duration="{timing["intro"]:.6f}" '
            f'data-media-start="{creator["introOffset"]:.6f}" data-track-index="1"></video>'
        )
    else:
        visual('opening', 0, timing['intro'], still=hold(selected[0] if selected else None))
        copy_layer('hook', 0, timing['intro'], c['hook'], c['secondaryHook'], brandline)

    clock = timing['intro']
    count = len(scenes)
    for i, scene in enumerate(scenes):
        length = scene['duration']
        id = f'scene-{i}'
        visual(id, clock, length, scene=scene)
        if i == 0 and content.get('secondaryHook'):
            headline = content['secondaryHook']
        elif i == count - 1 and content.get('benefit'):
            headline = content['benefit']
        else:
            headline = scene['headline']
        kicker = scene['headline'] if headline != scene['headline'] else brandline
        copy_layer(id + '-copy', clock, length, headline, kicker=kicker)
        proof.append(clock + length * .62)
        clock += length

    if creator.get('outroVideo'):
        outro_src = media(creator['outroVideo'], 'video')
        pieces.append(
            f'<video id="creator-outro" class="clip creator-showcase-video" '
            f'src="{escape(outro_src)}" muted playsinline data-start="{clock:.6f}" '
            f'data-duration="{timing["outro"]:.6f}" '
            f'data-media-start="{creator["outroOffset"]:.6f}" data-track-index="1"></video>'
        )
    else:
        visual('closing', clock, timing['outro'],
               still=hold(selected[-1] if selected else None, last=True))

    end_headline = content.get('benefit') or content.get('finalTagline') or brand['businessName']
    copy_layer('end', clock, timing['outro'], end_headline, kicker=brandline, end=True)

    for i, cue in enumerate(ctx['cues']):
        clip(
            f'caption-{i}',
            cue['start'],
            cue['end'] - cue['start'],
            f'<div class="showcase-caption">{escape(cue["text"])}</div>',
            'showcase-captions',
            8,
        )

    pieces.append(
        f'<audio id="master-audio" src="assets/master.wav" data-start="0" '
        f'data-duration="{duration}" data-volume="1" data-track-index="10"></audio>'
    )

    css = (ROOT / 'templates/website-showcase-v2/layout.css').read_text()
    css += f'\n.stage{{--showcase-accent:{accent};}}'
    css += (
        f'\nhtml,body{{width:{settings["width"]}px;height:{settings["height"]}px}}'
        f'.stage{{transform:scale({settings["width"] / 1080})}}'
    )
    classes = 'stage website-showcase-v2 preset-' + c['stylePreset']
    if ctx['cues']:
        classes += ' with-captions'

    fit = """document.fonts.ready.then(()=>{
      document.querySelectorAll('.showcase-headline').forEach(el=>{
        let size=parseFloat(getComputedStyle(el).fontSize);
        while(el.scrollHeight>330 && size>34){size-=1;el.style.fontSize=size+'px';}
      });
    });"""
    document = (
        '<!doctype html><html lang="es"><head><meta charset="utf-8">'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; '
        'script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\';">'
        '<title>Website Showcase V2</title>'
        '<script src="assets/vendor/gsap.min.js"></script><style>' + css + '</style></head><body>'
    )
    document += (
        f'<div id="root" data-composition-id="website-showcase-v2" '
        f'data-duration="{duration}" data-width="{settings["width"]}" '
        f'data-height="{settings["height"]}" data-fps="{settings["fps"]}">'
        f'<div class="{classes}" data-style-preset="{c["stylePreset"]}">'
        + ''.join(pieces) + '</div></div>'
        '<script>const tl=gsap.timeline({paused:true});'
        + ''.join(motions)
        + "window.__timelines['website-showcase-v2']=tl;"
        + fit
        + '</script></body></html>'
    )
    (comp / 'index.html').write_text(document, encoding='utf-8')
    write_json(
        comp / 'package.json',
        {'private': True, 'scripts': {'check': 'hyperframes check', 'render': 'hyperframes render'},
         'devDependencies': {'hyperframes': '0.8.114'}},
    )
    write_json(comp / 'hyperframes.json', {'meta': {'name': 'Website Showcase V2'}})
    return comp, [timing['intro'] * .6] + proof + [duration - min(.7, timing['outro'] / 2)]
