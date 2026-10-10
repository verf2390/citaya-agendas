"""Non-destructive master-video remix renderer.

The supplied master video remains the visual timeline. Generated narration and
source-audio ducking are prepared upstream; this renderer never re-cuts, crops,
retimes or replaces the user's montage.
"""
import html
import shutil

from production import ROOT, MODES, asset, digest, write_json


def compile_master_video_remix(c, ctx, out, mode):
    comp = out / 'composition'
    comp.mkdir()
    inputs = comp / 'assets' / 'inputs'
    inputs.mkdir(parents=True)

    for relative in ('vendor/gsap.min.js', 'branding/geist.woff2'):
        dest = comp / 'assets' / relative
        dest.parent.mkdir(exist_ok=True)
        shutil.copy2(ROOT / 'assets' / relative, dest)

    source = asset(c['creator']['introVideo'], 'video')
    src = ROOT / source
    name = digest(src)[:16] + src.suffix.lower()
    shutil.copy2(src, inputs / name)

    duration = sum(c['timing'].values())
    settings = MODES[mode]
    scale = settings['width'] / 1080
    brand = html.escape(c['brand']['businessName'], quote=True)
    brand_start = max(0.0, duration - 2.2)
    brand_duration = duration - brand_start

    css = f"""
@font-face{{font-family:Geist;src:url('assets/branding/geist.woff2');font-weight:100 900;font-display:block}}
*{{box-sizing:border-box}}
html,body{{margin:0;width:{settings['width']}px;height:{settings['height']}px;overflow:hidden;background:#000;font-family:Geist,Arial,sans-serif}}
#root{{position:relative;width:100%;height:100%;overflow:hidden;background:#000}}
.stage{{position:absolute;inset:0;width:1080px;height:1920px;transform:scale({scale});transform-origin:top left;background:#000;overflow:hidden}}
.clip{{position:absolute;inset:0}}
.master-video{{width:1080px;height:1920px;object-fit:contain;object-position:center;background:#000}}
.master-brand{{display:flex;align-items:flex-start;justify-content:flex-start;padding:64px}}
.master-brand span{{display:inline-block;max-width:900px;padding:16px 22px;border-radius:16px;background:rgba(0,0,0,.72);color:#fff;font-size:28px;line-height:1.15;font-weight:700;letter-spacing:.8px}}
"""
    pieces = [
        f'<video id="master-video" class="clip master-video" src="assets/inputs/{name}" muted playsinline '
        f'data-start="0" data-duration="{duration:.6f}" data-media-start="0" data-track-index="0"></video>',
        f'<section id="master-brand" class="clip master-brand" data-start="{brand_start:.6f}" '
        f'data-duration="{brand_duration:.6f}" data-track-index="4"><span>{brand}</span></section>',
        f'<audio id="master-audio" src="assets/master.wav" data-start="0" '
        f'data-duration="{duration:.6f}" data-volume="1" data-track-index="10"></audio>',
    ]
    document = (
        '<!doctype html><html lang="es"><head><meta charset="utf-8">'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; '
        'script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\';">'
        '<title>Master Video Remix</title><script src="assets/vendor/gsap.min.js"></script><style>'
        + css + '</style></head><body>'
        f'<div id="root" data-composition-id="master-video-remix" data-duration="{duration:.6f}" '
        f'data-width="{settings["width"]}" data-height="{settings["height"]}" data-fps="{settings["fps"]}">'
        '<div class="stage">' + ''.join(pieces) + '</div></div>'
        "<script>const tl=gsap.timeline({paused:true});window.__timelines['master-video-remix']=tl;</script>"
        '</body></html>'
    )
    (comp / 'index.html').write_text(document, encoding='utf-8')
    write_json(comp / 'package.json', {
        'private': True,
        'scripts': {'check': 'hyperframes check', 'render': 'hyperframes render'},
        'devDependencies': {'hyperframes': '0.8.114'},
    })
    write_json(comp / 'hyperframes.json', {'meta': {'name': 'Master Video Remix V1'}})
    return comp, [0.5, duration / 2, max(0.5, duration - 0.5)]
