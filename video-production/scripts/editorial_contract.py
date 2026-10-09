"""Shared explicit project routing and provided-media policy (no brand heuristics)."""
import re
import unicodedata

PRODUCT_UI_MODES = {'service', 'calendar', 'customers', 'payments', 'campaign-preview'}

# Recognize a positive order, exclusivity and user-supplied visual material in
# the same clause. Boundaries keep a negation in another sentence independent.
_VISUAL_MATERIAL = re.compile(r'\b(?:archivos?|medios?|material|videos?|imagen(?:es)?|pantallazos?|capturas?)\b')
_SUPPLIED = re.compile(r'\b(?:adjunt|proporcion|suministr|entreg|envi|subid)\w*\b')
_USE_COMMAND = re.compile(r'\b(?:usa|use|usar|utiliza|utilice|utilizar|trabaja|trabaje|trabajar)\b')
_NOT_AN_ORDER = re.compile(r'\b(?:no|nunca|jamas|puedes|puede|podrias|podrian|podemos)\s+$|\bno\s+te\s+limites\s+a\s+$')
_EXCLUSIVE_AFTER = re.compile(r'^\s+(?:con\s+)?(?:solo|solamente|unicamente|exclusivamente)\b\s*(?:con\s+)?')
_EXCLUSIVE_BEFORE = re.compile(r'\b(?:solo|solamente|unicamente|exclusivamente)\s+$')
_OWNED = re.compile(r'\b(?:mis?|tus?|sus?|nuestros?|nuestras?|estos?|estas?|esos?|esas?)\b')
_PAIRED_MEDIA = re.compile(r'\bvideos?\b.{0,40}\b(?:pantallazos?|capturas?)\b.{0,40}\b(?:proporcion|subid|adjunt|suministr)\w*\b')
_NO_EXTRA_CONTENT = (
    r'\bno\s+(?:agregues|agregar|anadas|anadir|incluyas|incluir)\s+contenido\s+'
    r'que\s+no\s+este\s+en\s+(?:(?:los|las|el|la)\s+)?' +
    _VISUAL_MATERIAL.pattern + r'[^.;!?]{0,100}' + _SUPPLIED.pattern
)


def _provided_media_order(clause):
    for command in _USE_COMMAND.finditer(clause):
        before, after = clause[:command.start()], clause[command.end():]
        if _NOT_AN_ORDER.search(before):
            continue
        exclusive = _EXCLUSIVE_AFTER.match(after)
        if exclusive:
            material = after[exclusive.end():]
        elif _EXCLUSIVE_BEFORE.search(before):
            material = after
        else:
            # Preserve the existing "usar el video y pantallazos proporcionados" case.
            if _PAIRED_MEDIA.search(after):
                return True
            continue
        visual = _VISUAL_MATERIAL.search(material[:100])
        if visual and (_OWNED.search(material[:visual.start()]) or
                       _SUPPLIED.search(material[visual.end():visual.end() + 100])):
            return True
    return False


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
    for part in re.split(r'[.;!?]+', value):
        clause = re.sub(r'\s+', ' ', part).strip()
        if _provided_media_order(clause) or re.search(
            _NO_EXTRA_CONTENT + '|' +
            r'(?:pagina|web).{0,40}protagonista|\bno invent(?:ar|es|e)\s+(?:(?:ningun[oa]?|las?|un[oa]?)\s+)?(?:pantallas?|contenido)\b|only.{0,60}(?:provided|supplied|uploaded).{0,30}(?:media|assets|images|videos)', clause):
            return True
    return False


def media_first_state(config):
    """Read-only presentation of the same policy used by direction/render."""
    structured = config.get('mediaPolicy', {}).get('mediaFirst') is True
    effective = media_first(config)
    source = ('website_showcase' if config.get('videoType') == 'website_showcase' else
              'structured' if structured else 'brief' if effective else 'none')
    return {'structured': structured, 'effectiveMediaFirst': effective, 'source': source}


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
