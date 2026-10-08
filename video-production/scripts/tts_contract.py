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


_SMALL_ES = {
    0: 'cero', 1: 'uno', 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco',
    6: 'seis', 7: 'siete', 8: 'ocho', 9: 'nueve', 10: 'diez',
    11: 'once', 12: 'doce', 13: 'trece', 14: 'catorce', 15: 'quince',
    16: 'dieciséis', 17: 'diecisiete', 18: 'dieciocho', 19: 'diecinueve',
    20: 'veinte', 21: 'veintiuno', 22: 'veintidós', 23: 'veintitrés',
    24: 'veinticuatro', 25: 'veinticinco', 26: 'veintiséis',
    27: 'veintisiete', 28: 'veintiocho', 29: 'veintinueve',
}
_TENS_ES = {30: 'treinta', 40: 'cuarenta', 50: 'cincuenta', 60: 'sesenta', 70: 'setenta', 80: 'ochenta', 90: 'noventa'}
_HUNDREDS_ES = {200: 'doscientos', 300: 'trescientos', 400: 'cuatrocientos', 500: 'quinientos', 600: 'seiscientos', 700: 'setecientos', 800: 'ochocientos', 900: 'novecientos'}


def _apocope_currency_words(value):
    if value == 'uno':
        return 'un'
    if value.endswith('veintiuno'):
        return value[:-9] + 'veintiún'
    if value.endswith(' y uno'):
        return value[:-6] + ' y un'
    if value.endswith(' uno'):
        return value[:-4] + ' un'
    return value


def _spanish_integer(value):
    if not isinstance(value, int) or value < 0 or value > 999_999_999:
        return None
    if value < 30:
        return _SMALL_ES[value]
    if value < 100:
        ten = value // 10 * 10
        rest = value % 10
        return _TENS_ES[ten] if not rest else _TENS_ES[ten] + ' y ' + _SMALL_ES[rest]
    if value == 100:
        return 'cien'
    if value < 200:
        return 'ciento ' + _spanish_integer(value - 100)
    if value < 1000:
        hundred = value // 100 * 100
        rest = value % 100
        return _HUNDREDS_ES[hundred] if not rest else _HUNDREDS_ES[hundred] + ' ' + _spanish_integer(rest)
    if value < 1_000_000:
        thousands = value // 1000
        rest = value % 1000
        prefix = 'mil' if thousands == 1 else _apocope_currency_words(_spanish_integer(thousands)) + ' mil'
        return prefix if not rest else prefix + ' ' + _spanish_integer(rest)
    millions = value // 1_000_000
    rest = value % 1_000_000
    prefix = 'un millón' if millions == 1 else _apocope_currency_words(_spanish_integer(millions)) + ' millones'
    return prefix if not rest else prefix + ' ' + _spanish_integer(rest)


def _currency_amounts(brief):
    """Return only currency facts explicitly stated in the tenant brief."""
    if not isinstance(brief, str):
        return {}
    found = {}
    amount = r'(\d{1,3}(?:[. ]\d{3})+|\d{4,9})'
    patterns = (
        (rf'\$\s*{amount}\s*(?:pesos?|CLP)\b', 'pesos'),
        (rf'\b(?:CLP|pesos?)\s*\$?\s*{amount}\b', 'pesos'),
        (rf'\$\s*{amount}\s*(?:d[oó]lares?|USD)\b', 'dólares'),
        (rf'\b(?:USD|d[oó]lares?)\s*\$?\s*{amount}\b', 'dólares'),
    )
    for pattern, unit in patterns:
        for match in re.finditer(pattern, brief, re.I):
            raw = match.group(1)
            digits = re.sub(r'[^0-9]', '', raw)
            if digits:
                found[int(digits)] = unit
    return found


def normalize_narration_currency(text, brief):
    """Speak an explicitly declared currency without changing visual copy."""
    safe = narration_text(text)
    facts = _currency_amounts(brief)
    if not facts:
        return safe

    pattern = re.compile(r'\$\s*(\d{1,3}(?:[. ]\d{3})+|\d{4,9})(?:\s*(?:pesos?|CLP|d[oó]lares?|USD))?', re.I)

    def replace(match):
        digits = re.sub(r'[^0-9]', '', match.group(1))
        if not digits:
            return match.group(0)
        value = int(digits)
        unit = facts.get(value)
        words = _spanish_integer(value)
        if not unit or not words:
            return match.group(0)
        return f'{_apocope_currency_words(words)} {unit}'

    return narration_text(pattern.sub(replace, safe))


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
        speech_text = normalize_narration_currency(text, brief)
        audio = config.setdefault('audio', {})
        previous = normalize_tts(audio['tts']) if 'tts' in audio else {}
        audio['tts'] = normalize_tts({**previous, 'enabled': True, 'text': speech_text})
    validate_tts_config(config)
