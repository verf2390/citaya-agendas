"""Closed narration contract. Text is data, never instructions or runtime options."""
import math
import re
import unicodedata

VOICE_ALIASES = ('es-male-1',)
TTS_ERRORS = frozenset({
    'TTS_DEPENDENCY_MISSING', 'TTS_INVALID_CONFIG', 'TTS_VOICE_UNSUPPORTED',
    'TTS_SYNTHESIS_FAILED', 'TTS_INVALID_OUTPUT', 'TTS_DURATION_EXCEEDS_VIDEO',
    'TTS_VOICE_CONFLICT',
})


def reject(code='TTS_INVALID_CONFIG'):
    from production import fail
    # Never expose input text, runtime paths or provider diagnostics.
    fail(code, code)


def narration_text(value):
    if (not isinstance(value, str) or not value.strip() or len(value) > 1200
            or any(unicodedata.category(ch).startswith('C') for ch in value)):
        reject()
    forbidden = (
        r'\b(?:asset|file|data):|[<>/\\`|]|\$\(|\$\{|\[\[|\]\]|://|\bwww\.|'
        r'\b[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[\w-]+\.[a-z]{2,63}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|'
        r'\b(?:sk|sb_secret)[_-]\S+|\beyJ[\w.-]{15,}|-----BEGIN|'
        r'\bBearer\s+\S+|\b(?:[\w-]*token|password|contrase[ñn]a|secret|api[_-]?key)\s*[:=]|'
        r'\b(?:sudo|curl|wget|bash|powershell)\b|\brm\s+-|\bpython\S*\s+-c\b|'
        r'\b(?:ignore|ignora|olvida)\b.{0,50}\b(?:instructions|instrucciones|prompt)\b|'
        r'\b(?:system|assistant|developer|sistema)\s*:'
    )
    if re.search(forbidden, value, re.I):
        reject()
    return value.strip()


def normalize_tts(value):
    if not isinstance(value, dict) or set(value) - {'enabled', 'text', 'voice', 'speed', 'start'}:
        reject()
    if type(value.get('enabled')) is not bool:
        reject()
    enabled = value['enabled']
    if enabled or 'text' in value:
        text = narration_text(value.get('text'))
    voice = value.get('voice', 'es-male-1')
    if not isinstance(voice, str) or voice not in VOICE_ALIASES:
        reject('TTS_VOICE_UNSUPPORTED')
    speed, start = value.get('speed', 1.0), value.get('start', 0.0)
    if type(speed) not in (int, float) or not math.isfinite(speed) or not .9 <= speed <= 1.1:
        reject()
    if type(start) not in (int, float) or not math.isfinite(start) or not 0 <= start <= 120:
        reject()
    return {'enabled': True, 'text': text, 'voice': voice, 'speed': float(speed), 'start': float(start)} if enabled else {'enabled': False}


def validate_tts_config(config, duration=None):
    if not isinstance(config, dict) or not isinstance(config.get('audio'), dict) or 'tts' not in config['audio']:
        return None
    tts = normalize_tts(config['audio']['tts'])
    if tts['enabled']:
        media, creator = config.get('media') or {}, config.get('creator') or {}
        if (isinstance(media, dict) and any(media.get(k) for k in ('clientVoiceover', 'creatorVoiceover'))
                or isinstance(creator, dict) and creator.get('voiceover')):
            reject('TTS_VOICE_CONFLICT')
        if duration is not None and tts['start'] >= duration:
            reject()
    return tts


def estimate_tts_seconds(text, speed=1.0):
    """Conservative planning budget; measured synthesis remains authoritative."""
    safe = narration_text(text)
    if type(speed) not in (int, float) or not math.isfinite(speed) or not .9 <= speed <= 1.1:
        reject()
    words = len(safe.split())
    # Chatterbox duration varies with punctuation, numbers and pronunciation. This
    # deliberately budgets slower than normal speech so Director timelines do not
    # routinely fail after the expensive synthesis step. The actual WAV duration
    # is still checked by tts_provider and is never truncated to fit this estimate.
    seconds = max(len(safe) / 10.0, words / 1.8) + 0.75
    return round(seconds / float(speed), 3)


NARRATION = re.compile(r'^\s*(?:#{1,6}\s*)?(?:\*\*)?(LOCUCI[ÓO]N|NARRACI[ÓO]N|VOICEOVER)(?:\*\*)?\s*:(?:\*\*)?\s*(.*)$', re.I)
HEADING = re.compile(r'^\s*(?:#{1,6}\s*)?(?:\*\*)?([\wÁÉÍÓÚÜÑáéíóúüñ -]{1,60})(?:\*\*)?\s*:(?:\*\*)?\s*(.*)$')
SECTION = re.compile(r'^(?:voz|estilo|m[uú]sica|audio|cta|escenas?(?: \d+)?|visual(?:es)?|duraci[oó]n|formato|objetivo|cierre|intro|outro|branding|texto|oferta|precio|contacto|notas|instrucciones)$', re.I)


def extract_narration(brief):
    """Explicit, line-anchored block only. Newlines become speech word spaces."""
    lines = brief.splitlines()
    headers = [(i, NARRATION.match(line)) for i, line in enumerate(lines) if NARRATION.match(line)]
    if not headers:
        return None
    if len(headers) != 1:
        reject()
    index, match = headers[0]
    body = [match.group(2)]
    for line in lines[index + 1:]:
        heading = HEADING.match(line)
        if heading and (heading.group(1).strip().isupper() or SECTION.fullmatch(heading.group(1).strip())):
            break
        if re.match(r'^\s*#{1,6}\s+\S', line):
            break
        body.append(line.strip())
    result = ' '.join(line for line in body if line).strip()
    for left, right in [('“', '”'), ('«', '»'), ('"', '"'), ("'", "'")]:
        if result.startswith(left) and result.endswith(right) and len(result) >= 2:
            result = result[1:-1].strip()
            break
    return narration_text(result)


def apply_brief_narration(config, brief):
    text = extract_narration(brief)
    if text is not None:
        audio = config.setdefault('audio', {})
        previous = normalize_tts(audio['tts']) if 'tts' in audio else {}
        audio['tts'] = normalize_tts({**previous, 'enabled': True, 'text': text})
    validate_tts_config(config)
