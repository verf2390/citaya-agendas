"""Shared explicit project routing and provided-media policy (no brand heuristics)."""
import re
import unicodedata

PRODUCT_UI_MODES = {'service', 'calendar', 'customers', 'payments', 'campaign-preview'}


def agenda_project(config):
    return (config.get('product') == 'citaya-agendas' or
            config.get('project', {}).get('productContext') == 'citaya-agendas')


def media_first(config, brief=None):
    if config.get('mediaPolicy', {}).get('mediaFirst') is True:
        return True
    if config.get('videoType') == 'website_showcase':
        return True
    value = brief if brief is not None else config.get('project', {}).get('creativeBrief', '')
    value = ''.join(c for c in unicodedata.normalize('NFKD', str(value).lower()) if not unicodedata.combining(c))
    value = re.sub(r'\s+', ' ', value)
    return bool(re.search(
        r'(?:unicamente|solo|solamente|exclusivamente).{0,100}(?:medios|material|videos?|imagenes|pantallazos|capturas).{0,80}(?:proporcionad|subid|adjunt|suministrad)|'
        r'(?:videos?).{0,40}(?:pantallazos|capturas).{0,40}(?:proporcionad|subid|adjunt|suministrad)|'
        r'(?:pagina|web).{0,40}protagonista|no invent(?:ar|es|e) pantallas|only.{0,60}(?:provided|supplied|uploaded).{0,30}(?:media|assets|images|videos)', value))


def selected_visual_ids(config):
    """Exactly the visual inputs chosen by the editor; audio never enters vision."""
    media = config.get('media', {})
    refs = [x for k in ('images', 'screenshots', 'videos') for x in media.get(k, [])]
    refs += [media.get(k) for k in ('creatorIntro', 'creatorOutro')]
    refs += [config.get('brand', {}).get(k) for k in ('logo', 'logoLight', 'logoDark')]
    refs += [s.get(k) for s in config.get('scenes', []) for k in ('media', 'video', 'beforeMedia', 'afterMedia')]
    return sorted({r[6:] for r in refs if isinstance(r, str) and r.startswith('asset:')})
