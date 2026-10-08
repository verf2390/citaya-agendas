"""Private CPU child. Only operator-installed Piper; no downloader/server imports."""
import ctypes
import errno
import json
from pathlib import Path
import resource
import sys
import wave


def deny_network():
    """Linux seccomp survives native ONNX calls too; fail closed if unavailable."""
    lib = ctypes.CDLL('libseccomp.so.2')
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    ctx = lib.seccomp_init(0x7fff0000)  # allow all except networking below
    if not ctx:
        raise RuntimeError('network guard unavailable')
    try:
        for name in (b'socket', b'socketpair', b'connect', b'sendto', b'sendmsg', b'sendmmsg', b'socketcall', b'io_uring_setup'):
            number = lib.seccomp_syscall_resolve_name(name)
            if number >= 0 and lib.seccomp_rule_add(ctx, 0x00050000 | errno.EPERM, number, 0) != 0:
                raise RuntimeError('network guard unavailable')
        if lib.seccomp_load(ctx) != 0:
            raise RuntimeError('network guard unavailable')
    finally:
        lib.seccomp_release(ctx)


def main():
    try:
        deny_network()
        # -I excludes PYTHONPATH/user packages. This directory is trusted code.
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from tts_contract import normalize_tts
        value = normalize_tts(json.loads(sys.stdin.read(12000)))
        if not value['enabled']:
            return 2
        from piper import PiperVoice, SynthesisConfig
        model = Path('/home/verf/apps/citaya-tts-runtime/models/es_MX-claude-high.onnx')
        voice = PiperVoice.load(model, use_cuda=False)
        settings = SynthesisConfig(length_scale=1.0 / value['speed'], normalize_audio=False)
        with wave.open(sys.argv[1], 'wb') as wav:
            voice.synthesize_wav(value['text'], wav, syn_config=settings)
        print(json.dumps({'networkDenied': True, 'peakRssKiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}))
        return 0
    except (ImportError, OSError):
        return 3
    except Exception:
        return 2


if __name__ == '__main__':
    sys.exit(main())
