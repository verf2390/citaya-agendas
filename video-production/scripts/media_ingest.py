"""Safe local media-folder ingestion for Citaya Video Studio."""

import copy
import json
import re
import unicodedata
from pathlib import Path

from production import ROOT, ConfigError, digest, inspect_media, validate

REPO_ROOT = ROOT.parent
INPUT_ROOT = (ROOT / "inputs").resolve()
MAX_FILES = 40
EXT_KIND = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
    ".mp4": "video", ".mov": "video", ".webm": "video",
    ".wav": "audio", ".mp3": "audio", ".m4a": "audio", ".ogg": "audio",
    ".srt": "subtitle", ".vtt": "subtitle",
}
MAX_BYTES = {
    "image": 25 * 1024 * 1024,
    "video": 1024 * 1024 * 1024,
    "audio": 200 * 1024 * 1024,
    "subtitle": 2 * 1024 * 1024,
}


class MediaIngestError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def fail(code, message):
    raise MediaIngestError(code, message)


def _tokens(path):
    value = " ".join([path.stem] + list(path.parent.parts[-2:])).casefold()
    value = "".join(
        char for char in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(char)
    )
    return set(re.findall(r"[a-z0-9]+", value))


def resolve_media_dir(value):
    raw = Path(value)
    candidates = []
    if raw.is_absolute():
        candidates.append(raw)
    else:
        candidates.extend([REPO_ROOT / raw, ROOT / raw, ROOT / "inputs" / "projects" / raw])
    selected = next((p for p in candidates if p.exists()), candidates[0])
    if selected.is_symlink():
        fail("UNSAFE_MEDIA_DIR", "La carpeta de material no puede ser un symlink.")
    path = selected.resolve()
    if path == INPUT_ROOT or not path.is_relative_to(INPUT_ROOT):
        fail("UNSAFE_MEDIA_DIR", "La carpeta debe estar dentro de video-production/inputs/.")
    if not path.exists() or not path.is_dir():
        fail("MEDIA_DIR_NOT_FOUND", "No existe la carpeta de material: " + str(value))
    return path


def _role(path, kind):
    tokens = _tokens(path)
    if kind == "image":
        if "logo" in tokens:
            return "logo"
        if tokens & {"screenshot", "screenshots", "screen", "captura", "capturas"}:
            return "screenshots"
        return "images"
    if kind == "video":
        if tokens & {"intro", "opening", "inicio"}:
            return "creatorIntro"
        if tokens & {"outro", "closing", "cierre", "final"}:
            return "creatorOutro"
        return "videos"
    if kind == "audio":
        if tokens & {"voice", "voiceover", "voz", "narracion", "narration"}:
            return "creatorVoiceover"
        if tokens & {"music", "musica", "background", "bgm", "fondo"}:
            return "backgroundMusic"
        if tokens & {"sfx", "fx", "effect", "effects", "efecto", "efectos"}:
            return "soundEffects"
        fail("AMBIGUOUS_AUDIO", "Audio sin rol claro: " + path.name + ". Renombralo con voiceover, music o sfx.")
    return "srt" if path.suffix.lower() == ".srt" else "vtt"


def _inspect(path, kind):
    size = path.stat().st_size
    if size <= 0:
        fail("EMPTY_MEDIA", "Archivo vacio: " + path.name)
    if size > MAX_BYTES[kind]:
        fail("MEDIA_TOO_LARGE", "{} supera el limite de {} MB.".format(path.name, MAX_BYTES[kind] // (1024 * 1024)))
    if kind == "subtitle":
        try:
            text = path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError):
            fail("INVALID_SUBTITLE", "Subtitulos deben ser UTF-8: " + path.name)
        if "-->" not in text or not text.strip():
            fail("INVALID_SUBTITLE", "Archivo de subtitulos sin cues reconocibles: " + path.name)
        return {"type": "subtitle", "bytes": size, "durationMs": None, "width": None, "height": None, "codec": path.suffix.lower()[1:], "sha256": digest(path)}
    try:
        return inspect_media(path)
    except ConfigError as exc:
        fail(exc.code, str(exc))


def scan_media(value):
    directory = resolve_media_dir(value)
    files = []
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            fail("UNSAFE_MEDIA_PATH", "No se aceptan symlinks dentro de la carpeta de material.")
        if path.is_dir():
            continue
        if not path.is_file():
            continue
        if path.name.startswith("."):
            fail("UNSUPPORTED_MEDIA", "Retira archivos ocultos de la carpeta: " + path.name)
        kind = EXT_KIND.get(path.suffix.lower())
        if not kind:
            fail("UNSUPPORTED_MEDIA", "Formato no soportado: " + path.name)
        if len(files) >= MAX_FILES:
            fail("TOO_MANY_MEDIA_FILES", "Maximo {} archivos por proyecto.".format(MAX_FILES))
        resolved = path.resolve()
        if not resolved.is_relative_to(INPUT_ROOT):
            fail("UNSAFE_MEDIA_PATH", "Un archivo sale de video-production/inputs/.")
        rel = resolved.relative_to(ROOT.resolve()).as_posix()
        role = _role(path, kind)
        files.append({"path": rel, "role": role, "inspection": _inspect(resolved, kind)})
    if not files:
        fail("EMPTY_MEDIA_DIR", "La carpeta no contiene medios soportados.")

    singleton = {"logo", "creatorIntro", "creatorOutro", "creatorVoiceover", "backgroundMusic", "srt", "vtt"}
    for role in singleton:
        matches = [item for item in files if item["role"] == role]
        if len(matches) > 1:
            fail("AMBIGUOUS_MEDIA_ROLE", "Hay mas de un archivo para {}: {}".format(role, ", ".join(x["path"] for x in matches)))
    if any(x["role"] == "srt" for x in files) and any(x["role"] == "vtt" for x in files):
        fail("AMBIGUOUS_SUBTITLES", "Usa SRT o VTT, no ambos.")

    by_role = {}
    for item in files:
        by_role.setdefault(item["role"], []).append(item["path"])
    patch = {}
    if by_role.get("logo"):
        patch["brand"] = {"logo": by_role["logo"][0]}
    media = {}
    for role in ("images", "videos", "screenshots", "soundEffects"):
        if by_role.get(role):
            media[role] = by_role[role]
    for role in ("creatorIntro", "creatorOutro", "creatorVoiceover", "backgroundMusic"):
        if by_role.get(role):
            media[role] = by_role[role][0]
    if media:
        patch["media"] = media
    if by_role.get("srt") or by_role.get("vtt"):
        key = "srt" if by_role.get("srt") else "vtt"
        patch["subtitles"] = {"enabled": True, key: by_role[key][0]}
    relative_dir = directory.relative_to(ROOT.resolve()).as_posix()
    return {"schemaVersion": 1, "mediaDir": relative_dir, "files": files, "configPatch": patch}


def summary(manifest):
    lines = ["Material detectado:"]
    for item in manifest["files"]:
        info = item["inspection"]
        detail = []
        if info.get("width") and info.get("height"):
            detail.append("{}x{}".format(info["width"], info["height"]))
        if info.get("durationMs") is not None:
            detail.append("{:.2f}s".format(info["durationMs"] / 1000))
        detail.append("{} KB".format(max(1, round(info["bytes"] / 1024))))
        lines.append("- {} -> {} ({})".format(item["path"], item["role"], ", ".join(detail)))
    return "\n".join(lines)


def _manifest_duration_seconds(manifest, role):
    for item in manifest.get("files", []):
        if item.get("role") != role:
            continue
        duration_ms = item.get("inspection", {}).get("durationMs")
        if type(duration_ms) in (int, float) and duration_ms > 0:
            return duration_ms / 1000
    return None


def _fit_creator_voice_timeline(config, manifest):
    """Fit creator-led demo pacing to reviewed narration instead of filler time."""
    media = config.get("media", {})
    if config.get("template") != "creator-led-v1" or not (media.get("creatorIntro") and media.get("creatorVoiceover")):
        return
    voice_seconds = _manifest_duration_seconds(manifest, "creatorVoiceover")
    if voice_seconds is None:
        return
    scenes = config.get("scenes", [])
    minimum_demo = max(3.0, 1.4 * len(scenes))
    demo = round(max(minimum_demo, voice_seconds + 0.6), 3)
    timing = config.setdefault("timing", {})
    timing["demo"] = demo
    if scenes:
        each = round(demo / len(scenes), 6)
        for scene in scenes[:-1]:
            scene["duration"] = each
        scenes[-1]["duration"] = round(demo - each * (len(scenes) - 1), 6)


def apply_manifest(config, manifest, approved):
    if not approved:
        fail("MEDIA_APPROVAL_REQUIRED", "Revisa el manifiesto y repite con --approve-media para confirmar derechos y privacidad.")
    c = copy.deepcopy(config)
    patch = manifest.get("configPatch", {})
    for section in ("brand", "media", "subtitles"):
        if section in patch:
            current = c.setdefault(section, {})
            for key, value in patch[section].items():
                if key in current and current[key] not in (None, [], {}) and current[key] != value:
                    fail("MEDIA_CONFIG_CONFLICT", "El config ya define {}.{} con otro valor.".format(section, key))
                current[key] = value
    media = c.get("media", {})
    if media.get("creatorIntro") and c.get("template") in ("citaya-saas-vertical-v1", "local-business-promo-v1"):
        c["template"] = "creator-led-v1"
    visuals = [("media", path) for path in media.get("images", []) + media.get("screenshots", [])]
    visuals += [("video", path) for path in media.get("videos", [])]
    for scene, (field, path) in zip(c.get("scenes", []), visuals):
        scene[field] = path
        if field == "media":
            scene["video"] = None
        else:
            scene["media"] = None
    _fit_creator_voice_timeline(c, manifest)
    if media.get("creatorIntro") or media.get("creatorOutro") or media.get("creatorVoiceover"):
        creator = c.setdefault("creator", {})
        creator.setdefault("useClipAudio", True)
        if media.get("creatorVoiceover"):
            # A normalized brief config already contains voiceoverStart=0 even before
            # media exists. When ingestion supplies both creator intro and voiceover,
            # place narration immediately after the intro instead of overlapping it.
            creator["voiceoverStart"] = c.get("timing", {}).get("intro", 0) if media.get("creatorIntro") else 0
        audio = c.setdefault("audio", {})
        audio.setdefault("music", True)
        audio.setdefault("sfx", True)
        audio["duckMusicDuringVoice"] = True
    c["mediaApproved"] = True
    try:
        return validate(c, "preview")[:2]
    except ConfigError as exc:
        fail(exc.code, str(exc))


def write_manifest(path, manifest):
    Path(path).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
