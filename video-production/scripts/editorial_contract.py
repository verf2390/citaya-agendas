"""Shared explicit project routing and provided-media policy (no brand heuristics)."""
import re
import unicodedata

PRODUCT_UI_MODES = {'service', 'calendar', 'customers', 'payments', 'campaign-preview'}

# Restriction + visual material + supplied provenance, within one clause. These
# are lexical constraints, not a semantic classifier: a mere suggestion to use
# images/videos does not require exclusive use of supplied assets.
_VISUAL_MATERIAL = r'\b(?:archivos?|medios?|material|videos?|imagen(?:es)?|pantallazos?|capturas?)\b'
_SUPPLIED = r'\b(?:adjunt|proporcion|suministr|entreg|envi|subid)\w*\b'
_CLAUSE = r'[^.;!?]'
_EXCLUSIVE_MEDIA = (
    r'\b(?:solo|solamente|unicamente|exclusivamente)\s+(?:con\s+)?'
    r'(?:(?:los|las|el|la)\s+)?' + _VISUAL_MATERIAL + _CLAUSE + r'{0,100}' + _SUPPLIED
)
_NO_EXTRA_CONTENT = (
    r'\bno\s+(?:agregues|agregar|anadas|anadir|incluyas|incluir)\s+contenido\s+'
    r'que\s+no\s+este\s+en\s+(?:(?:los|las|el|la)\s+)?' +
    _VISUAL_MATERIAL + _CLAUSE + r'{0,100}' + _SUPPLIED
)


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
        _EXCLUSIVE_MEDIA + '|' + _NO_EXTRA_CONTENT + '|' +
        r'(?:videos?).{0,40}(?:pantallazos|capturas).{0,40}(?:proporcionad|subid|adjunt|suministrad)|'
        r'(?:pagina|web).{0,40}protagonista|\bno invent(?:ar|es|e)\s+(?:(?:ningun[oa]?|las?|un[oa]?)\s+)?(?:pantallas?|contenido)\b|only.{0,60}(?:provided|supplied|uploaded).{0,30}(?:media|assets|images|videos)', value))


def selected_visual_ids(config):
    """Exactly the visual inputs chosen by the editor; audio never enters vision."""
    media = config.get('media', {})
    refs = [x for k in ('images', 'screenshots', 'videos') for x in media.get(k, [])]
    refs += [media.get(k) for k in ('creatorIntro', 'creatorOutro')]
    # Production still accepts legacy creator slots. Include both vocabularies
    # here so preparation, approval and validation gate every renderable input;
    # the set below deduplicates aliases pointing to the same asset.
    refs += [config.get('creator', {}).get(k) for k in ('introVideo', 'outroVideo')]
    refs += [config.get('brand', {}).get(k) for k in ('logo', 'logoLight', 'logoDark')]
    refs += [s.get(k) for s in config.get('scenes', []) for k in ('media', 'video', 'beforeMedia', 'afterMedia')]
    return sorted({r[6:] for r in refs if isinstance(r, str) and r.startswith('asset:')})
