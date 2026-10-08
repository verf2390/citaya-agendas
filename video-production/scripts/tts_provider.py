"""Local TTS adapter and post-synthesis timeline gate. No downloads or cloud fallback."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import wave
from typing import Protocol

from production import ConfigError, probe
from tts_contract import normalize_tts, reject, validate_tts_config

# Operator-installed Chatterbox evaluation runtime. This path is intentionally
# code-owned and not tenant configurable. Promote to a final runtime path only
# after the end-to-end Video Studio test passes.
RUNTIME = Path('/home/verf/apps/citaya-chatterbox-eval')
HF_HOME = Path('/home/verf/.cache/huggingface')
MODEL = 'chatterbox-es-mx-latam-v3'


class TTSProvider(Protocol):
    def synthesize(self, text, voice, speed, output_path) -> dict: ...


def private_work(job_dir):
    job_dir = Path(job_dir).absolute()
    if job_dir.is_symlink() or job_dir.resolve() != job_dir or not job_dir.is_dir():
        reject('TTS_INVALID_OUTPUT')
    work = job_dir / 'audio-work'
    if work.is_symlink():
        reject('TTS_INVALID_OUTPUT')
    try:
        work.mkdir(mode=0o700, exist_ok=True)
        os.chmod(work, 0o700)
    except OSError:
        reject('TTS_INVALID_OUTPUT')
    return work


def generated_path(path, job_dir):
    expected = Path(job_dir).absolute() / 'audio-work/narration.wav'
    path = Path(path)
    try:
        valid = (path == expected and not path.is_symlink() and path.resolve() == expected
                 and path.is_file() and path.stat().st_nlink == 1)
    except OSError:
        valid = False
    if not valid:
        reject('TTS_INVALID_OUTPUT')
    return path


def inspect_wav(path):
    try:
        if path.is_symlink() or not stat.S_ISREG(path.stat().st_mode) or not 44 < path.stat().st_size <= 64_000_000:
            reject('TTS_INVALID_OUTPUT')
        with wave.open(str(path), 'rb') as wav:
            rate, channels, frames = wav.getframerate(), wav.getnchannels(), wav.getnframes()
            if wav.getsampwidth() != 2 or channels not in (1, 2) or not 16000 <= rate <= 48000 or not 0 < frames <= rate * 300:
                reject('TTS_INVALID_OUTPUT')
            pcm = wav.readframes(frames)
            if len(pcm) != frames * channels * 2 or not any(pcm):
                reject('TTS_INVALID_OUTPUT')
        info = probe(path)
        streams = info['streams']
        actual = float(info['format']['duration'])
        if (len(streams) != 1 or streams[0]['codec_name'] != 'pcm_s16le'
                or not math.isfinite(actual) or abs(actual - frames / rate) > .001):
            reject('TTS_INVALID_OUTPUT')
        return {'durationSeconds': actual, 'sampleRate': rate, 'channels': channels, 'frames': frames}
    except (ConfigError, OSError, ValueError, KeyError, wave.Error, EOFError):
        reject('TTS_INVALID_OUTPUT')


class LocalTTSProvider:
    """Pinned Chatterbox LATAM voice on CPU in a separate, network-denied process."""
    def synthesize(self, text, voice, speed, output_path):
        tts = normalize_tts({'enabled': True, 'text': text, 'voice': voice, 'speed': speed})
        output_path = Path(output_path).absolute()
        generated_path(output_path, output_path.parent.parent)

        python = RUNTIME / '.venv/bin/python'
        source = RUNTIME / 'space/chatterbox/src/chatterbox/tts.py'
        reference = RUNTIME / 'benchmarks/es_mx_f1.wav'
        if not all(p.is_file() for p in (python, source, reference)):
            reject('TTS_DEPENDENCY_MISSING')

        started = time.monotonic()
        try:
            result = subprocess.run(
                [str(python), '-I', str(Path(__file__).with_name('tts_chatterbox_runner.py')),
                 str(output_path), str(RUNTIME)],
                input=json.dumps(tts, ensure_ascii=False), text=True, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, timeout=900, check=False, close_fds=True,
                env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8',
                     'OMP_NUM_THREADS': '4', 'OPENBLAS_NUM_THREADS': '4',
                     'HF_HOME': str(HF_HOME), 'HF_HUB_OFFLINE': '1',
                     'TRANSFORMERS_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1'},
            )
            if result.returncode != 0:
                reject('TTS_DEPENDENCY_MISSING' if result.returncode == 3 else 'TTS_SYNTHESIS_FAILED')
            info = json.loads(result.stdout) if len(result.stdout) < 4096 else None
            if not isinstance(info, dict) or info.get('networkDenied') is not True:
                reject('TTS_SYNTHESIS_FAILED')
            elapsed = time.monotonic() - started
            measured = inspect_wav(Path(output_path))
            return {'provider': 'local-tts', 'model': MODEL, 'voice': voice,
                    **measured, 'inferenceSeconds': round(elapsed, 6),
                    'peakRssKiB': info.get('peakRssKiB')}
        except (OSError, subprocess.SubprocessError, ValueError):
            reject('TTS_SYNTHESIS_FAILED')


def prepare_tts(c, ctx, job_dir, provider=None):
    """Append a measured, trusted speech segment only after every gate passes."""
    duration = sum(c['timing'].values())
    tts = validate_tts_config(c, duration)
    if not tts or not tts['enabled']:
        return None
    if ctx.get('ttsMetadata') or any(s.get('generatedPath') for s in ctx['speech']):
        reject('TTS_INVALID_CONFIG')
    if c['audio']['music'] and not c['audio']['duckMusicDuringVoice']:
        from production import fail
        fail('VOICE_DUCKING_REQUIRED', 'Music under speech requires duckMusicDuringVoice=true.')
    work = private_work(job_dir)
    output = work / 'narration.wav'
    try:
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except OSError:
        reject('TTS_INVALID_OUTPUT')
    os.close(fd)
    try:
        try:
            metadata = (provider or LocalTTSProvider()).synthesize(tts['text'], tts['voice'], tts['speed'], output)
        except ConfigError as exc:
            from tts_contract import TTS_ERRORS
            reject(exc.code if exc.code in TTS_ERRORS else 'TTS_SYNTHESIS_FAILED')
        except Exception:
            reject('TTS_SYNTHESIS_FAILED')
        output = generated_path(output, job_dir)
        os.chmod(output, 0o600)
        actual = inspect_wav(output)  # never trust a provider's declared duration
        # A sub-sample rounding allowance cannot hide audible truncation.
        end = tts['start'] + actual['durationSeconds']
        if end > duration + 1 / 48000:
            reject('TTS_DURATION_EXCEEDS_VIDEO')
        if any(tts['start'] < s['start'] + s['duration'] - .04 and end > s['start'] + .04 for s in ctx['speech']):
            from production import fail
            fail('OVERLAPPING_SPEECH', 'Narration overlaps creator clip audio.')
        if (not isinstance(metadata, dict)
                or any(not isinstance(metadata.get(k), str) or not re.fullmatch(r'[a-zA-Z0-9_.-]{1,100}', metadata[k]) for k in ('provider', 'model', 'voice'))
                or metadata['voice'] != tts['voice']
                or type(metadata.get('inferenceSeconds')) not in (int, float)
                or not math.isfinite(metadata['inferenceSeconds']) or metadata['inferenceSeconds'] < 0):
            reject('TTS_INVALID_OUTPUT')
        safe = {'voiceProvider': metadata['provider'], 'voiceModel': metadata['model'],
                'voiceAlias': tts['voice'], 'voiceGenerated': True,
                'voiceDurationSeconds': actual['durationSeconds'],
                'voiceSampleRate': actual['sampleRate'],
                'voiceInferenceSeconds': metadata['inferenceSeconds'],
                'voiceTextSha256': hashlib.sha256(tts['text'].encode('utf-8')).hexdigest(),
                'voiceSpeed': tts['speed']}
        if type(metadata.get('peakRssKiB')) is int and metadata['peakRssKiB'] > 0:
            safe['voicePeakRssKiB'] = metadata['peakRssKiB']
        ctx['speech'].append({'generatedPath': str(output), 'start': tts['start'],
                              'duration': actual['durationSeconds'], 'offset': 0})
        ctx['speech'].sort(key=lambda s: s['start'])
        ctx['ttsMetadata'] = safe
        return safe
    except Exception as exc:
        try:
            output.unlink(missing_ok=True)
        except OSError:
            pass
        if isinstance(exc, OSError):
            reject('TTS_INVALID_OUTPUT')
        raise
