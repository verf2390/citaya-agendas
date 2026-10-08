"""Private CPU child for Chatterbox LATAM. Offline assets only; no service or downloader."""
import contextlib
import ctypes
import errno
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import sys


def deny_network():
    """Linux seccomp survives native Torch calls too; fail closed if unavailable."""
    lib = ctypes.CDLL('libseccomp.so.2')
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    ctx = lib.seccomp_init(0x7fff0000)
    if not ctx:
        raise RuntimeError('network guard unavailable')
    try:
        for name in (b'socket', b'socketpair', b'connect', b'sendto', b'sendmsg',
                     b'sendmmsg', b'socketcall', b'io_uring_setup'):
            number = lib.seccomp_syscall_resolve_name(name)
            if number >= 0 and lib.seccomp_rule_add(ctx, 0x00050000 | errno.EPERM, number, 0) != 0:
                raise RuntimeError('network guard unavailable')
        if lib.seccomp_load(ctx) != 0:
            raise RuntimeError('network guard unavailable')
    finally:
        lib.seccomp_release(ctx)


def text_chunks(text, limit=300):
    """Split without truncation, preferring sentence boundaries and then words."""
    sentences = [x.strip() for x in re.split(r'(?<=[.!?])\\s+', text.strip()) if x.strip()]
    chunks = []
    current = ''

    def add_words(value):
        nonlocal current
        for word in value.split():
            if len(word) > limit:
                raise ValueError('word exceeds synthesis limit')
            candidate = f'{current} {word}'.strip()
            if len(candidate) <= limit:
                current = candidate
            else:
                if current:
                    chunks.append(current)
                current = word

    for sentence in sentences:
        candidate = f'{current} {sentence}'.strip()
        if len(candidate) <= limit:
            current = candidate
        elif len(sentence) <= limit:
            if current:
                chunks.append(current)
            current = sentence
        else:
            if current:
                chunks.append(current)
                current = ''
            add_words(sentence)
    if current:
        chunks.append(current)
    if not chunks:
        raise ValueError('empty narration')
    return chunks


def _write_pcm16(path, audio, sample_rate):
    import soundfile as sf
    sf.write(str(path), audio, sample_rate, subtype='PCM_16')
    os.chmod(path, 0o600)


def _apply_speed(raw_path, output_path, speed):
    if speed == 1.0:
        os.replace(raw_path, output_path)
        return
    result = subprocess.run(
        ['/usr/bin/ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
         '-i', str(raw_path), '-filter:a', f'atempo={speed:.6f}',
         '-acodec', 'pcm_s16le', str(output_path)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        timeout=120, check=False, close_fds=True,
    )
    raw_path.unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError('speed processing failed')


def main():
    if len(sys.argv) != 3:
        return 2
    output = Path(sys.argv[1]).absolute()
    runtime = Path(sys.argv[2]).absolute()
    raw = output.with_name(output.name + '.chatterbox-raw.wav')
    try:
        os.umask(0o077)
        deny_network()

        sys.path.insert(0, str(Path(__file__).resolve().parent))
        sys.path.insert(0, str(runtime / 'space/chatterbox/src'))
        from tts_contract import normalize_tts
        value = normalize_tts(json.loads(sys.stdin.read(12000)))
        if not value['enabled']:
            return 2

        reference = runtime / 'benchmarks/es_mx_f1.wav'
        if not reference.is_file():
            return 3

        with open(os.devnull, 'w') as devnull, contextlib.redirect_stdout(devnull), contextlib.redirect_stderr(devnull):
            try:
                import torch
                from chatterbox.tts import ChatterboxTTS
                model = ChatterboxTTS.from_pretrained(device='cpu')
            except Exception:
                return 3

            chunks = text_chunks(value['text'])
            pieces = []
            for index, chunk in enumerate(chunks):
                kwargs = {
                    'language_id': 'es',
                    'exaggeration': 0.5,
                    'temperature': 0.8,
                    'cfg_weight': 0.5,
                }
                if index == 0:
                    kwargs['audio_prompt_path'] = str(reference)
                wav = model.generate(chunk, **kwargs)
                pieces.append(wav.squeeze(0).detach().cpu())

            audio = torch.cat(pieces).numpy()
            _write_pcm16(raw, audio, model.sr)

        _apply_speed(raw, output, value['speed'])
        os.chmod(output, 0o600)
        print(json.dumps({
            'networkDenied': True,
            'peakRssKiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'chunks': len(chunks),
        }))
        return 0
    except (ImportError, OSError):
        raw.unlink(missing_ok=True)
        return 3
    except Exception:
        raw.unlink(missing_ok=True)
        return 2


if __name__ == '__main__':
    sys.exit(main())
