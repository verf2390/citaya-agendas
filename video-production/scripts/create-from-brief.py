#!/usr/bin/env python3
"""Natural-language brief -> local Qwen -> validated Video Studio config -> preview."""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from production import ConfigError, ROOT, read_json, validate, write_json

REPO_ROOT = ROOT.parent
ENV_FILE = REPO_ROOT / ".env.local"
MAX_CHUNK = 18000

SYSTEM = """Eres el asistente interno de CITAYA VIDEO STUDIO.
Devuelve exactamente UN objeto JSON valido, sin Markdown ni explicaciones.
No escribas codigo, comandos, credenciales, tenant_id ni aprobaciones.
Usa solo IDs incluidos en los catalogos entregados.
No inventes clientes, negocios, precios, descuentos, testimonios, resultados, imagenes ni funciones.
No declares capacidades planned o in_progress como disponibles; solo pueden aparecer en roadmap/concept.
No uses medios que el operador no haya proporcionado.
Puedes omitir timing y scenes: el motor determinista puede completarlos.
mediaApproved debe ser false; solo el operador humano puede aprobar medios.
Responde en espanol si el brief esta en espanol.
No muestres razonamiento. /no_think"""

class BriefError(RuntimeError):
    pass

def load_env(path):
    data = {}
    if not path.is_file():
        return data
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("\'", '"'):
            value = value[1:-1]
        data[key.strip()] = value
    return data

def setting(name, env, default=""):
    return os.environ.get(name, env.get(name, default)).strip()

def chunks(label, text):
    return [{"type": "user", "text": f"{label} PARTE {i // MAX_CHUNK + 1}:\n{text[i:i + MAX_CHUNK]}"}
            for i in range(0, len(text), MAX_CHUNK)]

def catalog_context():
    products = read_json(ROOT / "catalog/products.json")["products"]
    niches = read_json(ROOT / "catalog/niches.json")["niches"]
    templates = read_json(ROOT / "catalog/templates.json")["templates"]
    caps = read_json(ROOT / "catalog/capabilities.json")["capabilities"]
    compact = {
        "products": [{"id": x["id"], "status": x["status"], "defaultTemplate": x["defaultTemplate"], "allowedTemplates": x["allowedTemplates"]} for x in products],
        "niches": [{"id": x["id"], "name": x["name"]} for x in niches],
        "templates": [{"id": x["id"], "sceneModes": x["sceneModes"]} for x in templates],
        "capabilities": [{"id": x["id"], "product": x["product"], "status": x["status"], "safe": x["safeForCommercialVideo"], "niches": x["applicableNiches"], "scenes": x["suggestedScenes"], "benefit": (x.get("suggestedBenefits") or [""])[0], "gates": x.get("requiredGates", []), "also": x.get("alsoAppliesTo", [])} for x in caps],
        "allowedAssets": []
    }
    return json.dumps(compact, ensure_ascii=False, separators=(",", ":"))

def gateway_call(endpoint, token, model, brief, continuation=None, repair=None, timeout=90):
    if continuation is None:
        schema = json.dumps(read_json(ROOT / "schemas/video-config.schema.json"), ensure_ascii=False, separators=(",", ":"))
        inputs = [{"type": "user", "text": "BRIEF DEL OPERADOR:\n" + brief}]
        inputs += chunks("JSON SCHEMA", schema)
        inputs += chunks("CATALOGOS PERMITIDOS", catalog_context())
    else:
        inputs = [{"type": "user", "text": "Corrige tu propuesta anterior. Devuelve solo el objeto JSON completo. Error del validador: " + (repair or "respuesta invalida")}]
    payload = {
        "contractVersion": "citaya-ai-provider-v1",
        "model": model,
        "instructions": SYSTEM,
        "input": inputs,
        "tools": [],
        "maxOutputTokens": 2600,
        "continuation": continuation
    }
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(endpoint, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise BriefError(f"Gateway IA respondio HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise BriefError(f"No se pudo contactar el gateway IA: {type(exc).__name__}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise BriefError("El gateway IA devolvio una respuesta no JSON") from exc
    if not isinstance(data, dict) or not isinstance(data.get("text"), str):
        raise BriefError("Respuesta inesperada del gateway IA")
    return data

def parse_proposal(text):
    value = text.strip()
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.I)
    value = re.sub(r"\s*```$", "", value)
    value = re.sub(r"<think>.*?</think>", "", value, flags=re.I | re.S).strip()
    try:
        data = json.loads(value)
    except json.JSONDecodeError as exc:
        raise BriefError(f"Qwen devolvio JSON invalido: linea {exc.lineno}, columna {exc.colno}") from exc
    if not isinstance(data, dict):
        raise BriefError("Qwen debe devolver un objeto JSON")
    data["mediaApproved"] = False
    return data

def usage_of(response):
    usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
    return {k: int(usage.get(k, 0) or 0) for k in ("inputTokens", "outputTokens", "totalTokens")}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("brief", nargs="*")
    p.add_argument("--config-only", action="store_true")
    p.add_argument("--timeout", type=int, default=90)
    args = p.parse_args()
    brief = " ".join(args.brief).strip()
    if not brief:
        print("CITAYA VIDEO STUDIO")
        brief = input("\n¿Que video quieres crear?\n> ").strip()
    if not brief:
        raise BriefError("El brief no puede estar vacio")
    if len(brief) > 6000:
        raise BriefError("El brief supera 6000 caracteres")

    env = load_env(ENV_FILE)
    provider = setting("CITAYA_AI_PROVIDER", env, "local")
    model = setting("CITAYA_AI_LOCAL_MODEL", env)
    endpoint = setting("CITAYA_AI_LOCAL_ENDPOINT", env)
    token = setting("CITAYA_AI_LOCAL_AUTH_TOKEN", env)
    if provider not in ("local", "hybrid") or not model or not endpoint:
        raise BriefError("Configuracion local de Citaya AI incompleta")
    if not endpoint.startswith(("http://127.0.0.1:", "http://localhost:", "https://")):
        raise BriefError("Este flujo solo acepta gateway loopback HTTP o HTTPS")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    run_dir = ROOT / "outputs" / "briefs" / stamp
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "brief.txt").write_text(brief + "\n", encoding="utf-8")

    continuation = None
    last_error = None
    total = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}
    normalized = report = response = None
    for attempt in (1, 2):
        response = gateway_call(endpoint, token, model, brief, continuation, last_error, args.timeout)
        use = usage_of(response)
        for key in total:
            total[key] += use[key]
        continuation = response.get("continuation")
        try:
            proposal = parse_proposal(response["text"])
            normalized, report, _ = validate(proposal, "preview")
            break
        except (BriefError, ConfigError) as exc:
            last_error = str(exc)
            if attempt == 2:
                raise BriefError("Qwen no produjo un config valido tras una correccion: " + last_error) from exc

    config_path = run_dir / "generated-config.json"
    write_json(config_path, normalized)
    write_json(run_dir / "validation-report.json", report)
    write_json(run_dir / "ai-usage.json", {"provider": "local", "model": model, "attempts": attempt, **total})
    (run_dir / "ai-response.txt").write_text(response["text"].strip() + "\n", encoding="utf-8")

    print("\n=== PROPUESTA VALIDADA ===")
    print("Producto: ", normalized.get("product"))
    print("Nicho:    ", normalized.get("niche"))
    print("Plantilla:", normalized.get("template"))
    print("Tipo:     ", normalized.get("videoType"))
    print("Hook:     ", normalized.get("hook"))
    print("CTA:      ", normalized.get("cta"))
    print("IA:       ", "{} in / {} out / {} total".format(total["inputTokens"], total["outputTokens"], total["totalTokens"]))
    print("Config:   ", config_path)

    if args.config_only:
        print("Config validado. No se renderizo preview.")
        return

    print("\nGenerando preview local...")
    child_env = os.environ.copy()
    child_env.pop("CITAYA_AI_LOCAL_AUTH_TOKEN", None)
    cmd = [sys.executable, str(ROOT / "scripts/generate-video.py"), "--config", str(config_path), "--mode", "preview"]
    result = subprocess.run(cmd, cwd=REPO_ROOT, env=child_env, check=False)
    if result.returncode != 0:
        raise BriefError(f"El config fue valido, pero el preview termino con codigo {result.returncode}")

if __name__ == "__main__":
    try:
        main()
    except (BriefError, ConfigError) as exc:
        print("VIDEO_BRIEF_FAILED:", exc, file=sys.stderr)
        raise SystemExit(2)
