"""CIT-122: real gateway HTTP contract with a fake model; no Qwen required."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location("create_from_brief", ROOT / "scripts/create-from-brief.py")
brief = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brief)

BRIEF = "Haz un Reel de 20 segundos para promocionar Citaya Agendas para una barbería. Quiero destacar reserva online, elección de profesional y fecha/hora. Termina invitando a probar Citaya."
ROUTE = {"product": "citaya-agendas", "niche": "barber", "videoType": "sales_ad", "durationSeconds": 20}
PROPOSAL = {"hook": "Tu barbería, con reserva online", "secondaryHook": "Elige profesional, fecha y hora", "cta": "Prueba Citaya", "capabilities": ["online_booking", "professional_selection", "date_time_availability"]}
CATALOG = brief.catalog_context()


def response(data, **extra):
    return {"text": json.dumps(data, ensure_ascii=False), "toolCalls": [],
            "usage": {"inputTokens": 100, "outputTokens": 50, "totalTokens": 150},
            # A gateway can return large continuations; the client must ignore them.
            "continuation": {"messages": [{"role": "assistant", "content": "history" * 500}]}, **extra}


@contextlib.contextmanager
def gateway(replies):
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append((payload, self.headers.get("Authorization")))
            status, body = replies.pop(0) if replies else (500, {})
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            if status == 302:
                self.send_header("Location", "/redirected")
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1/generate", received
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class BriefTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.out = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def generate(self, endpoint):
        with contextlib.redirect_stdout(io.StringIO()):
            return brief.generate_config(BRIEF, endpoint, "test-credential", brief.MODEL, self.out)

    def metrics(self):
        return json.loads((self.out / "ai-usage.json").read_text())

    def test_real_http_contract_validated_and_bounded(self):
        with gateway([(200, response(ROUTE)), (200, response(PROPOSAL))]) as (url, requests):
            config, report = self.generate(url)
        self.assertEqual(report["duration"], 20)
        self.assertEqual(config["capabilities"], PROPOSAL["capabilities"])
        self.assertFalse(config["mediaApproved"])
        self.assertEqual(report["mode"], "preview")
        self.assertTrue(report["valid"])
        for (payload, auth), budget in zip(requests, (128, 256)):
            self.assertEqual(auth, "Bearer test-credential")
            self.assertEqual(payload["model"], brief.MODEL)
            self.assertEqual(payload["tools"], [])
            self.assertIsNone(payload["continuation"])
            self.assertEqual(payload["maxOutputTokens"], budget)
            prompt = payload["instructions"] + payload["input"][0]["text"]
            self.assertLessEqual(len(prompt.encode()) + brief.CHAT_OVERHEAD + budget, 4096)
            self.assertTrue(prompt.endswith("/no_think"))
            self.assertNotIn("test-credential", prompt)
            self.assertNotIn("$schema", prompt)
        self.assertNotIn("clinical_records", json.dumps(requests[1][0]))
        self.assertEqual(self.metrics()["totalTokens"], 300)
        self.assertEqual(self.metrics()["status"], "complete")
        for path in self.out.iterdir():
            self.assertNotIn("test-credential", path.read_text())
            self.assertNotIn("historyhistory", path.read_text())

    def test_repair_has_fresh_bounded_prompt_and_usage(self):
        bad = response(PROPOSAL, text='{"hook":')
        with gateway([(200, response(ROUTE)), (200, bad), (200, response(PROPOSAL))]) as (url, requests):
            self.generate(url)
        self.assertEqual(len(requests), 3)
        self.assertIsNone(requests[-1][0]["continuation"])
        self.assertIn("propuesta previa", requests[-1][0]["input"][0]["text"])
        self.assertEqual(self.metrics()["totalTokens"], 450)
        self.assertEqual(self.metrics()["calls"][1]["errorCode"], "INVALID_JSON")

    def test_invalid_classification_repaired_before_capability_selection(self):
        route = dict(ROUTE, product="invented-product")
        with gateway([(200, response(route)), (200, response(ROUTE)), (200, response(PROPOSAL))]) as (url, requests):
            self.generate(url)
        self.assertEqual([r[0]["maxOutputTokens"] for r in requests], [128, 128, 256])

    def test_truth_gates_filter_by_product_niche_status_and_permissions(self):
        caps = brief.relevant_capabilities("factura_33 clinical_records payment_links", ROUTE, CATALOG)
        self.assertTrue(caps)
        for cap in caps:
            self.assertFalse(cap.get("requiredGates"))
            self.assertTrue(cap["safeForCommercialVideo"])
            self.assertIn(cap["status"], ("live", "demo"))
            self.assertIn(ROUTE["product"], [cap["product"]] + cap.get("alsoAppliesTo", []))
        custom = copy.deepcopy(CATALOG)
        custom["capabilities"] = [dict(CATALOG["capabilities"][0], applicableNiches=["veterinary"])]
        self.assertEqual(brief.relevant_capabilities(BRIEF, ROUTE, custom), [])

    def test_requested_capabilities_survive_retrieval(self):
        ids = {c["id"] for c in brief.relevant_capabilities(BRIEF, ROUTE, CATALOG)}
        self.assertTrue(set(PROPOSAL["capabilities"]) <= ids)
        self.assertLessEqual(len(ids), 8)

    def test_alias_product_and_roadmap_use_catalog(self):
        route = dict(ROUTE, product="citaya-services", niche="architecture")
        caps = brief.relevant_capabilities("WordPress responsive", route, CATALOG)
        self.assertIn("wordpress_creation", {c["id"] for c in caps})
        route = dict(ROUTE, videoType="concept")
        caps = brief.relevant_capabilities("Historia clínica clinical_records", route, CATALOG)
        proposal = dict(PROPOSAL, capabilities=["clinical_records"], hook="Una mirada al futuro", secondaryHook="Concepto en desarrollo", cta="Conoce lo que viene")
        config, report = brief.normalize_proposal(proposal, route, caps)
        self.assertEqual(config["videoType"], "roadmap")
        self.assertIn("hoja de ruta", config["shareCopy"])
        self.assertEqual(report["capabilities"][0]["status"], "planned")

    def test_production_is_final_truth_authority_even_if_retrieval_is_wrong(self):
        for capability in ("clinical_records", "factura_33"):
            cap = next(c for c in CATALOG["capabilities"] if c["id"] == capability)
            with self.subTest(capability=capability), self.assertRaises(brief.ConfigError):
                brief.normalize_proposal(dict(PROPOSAL, capabilities=[capability]), ROUTE, [cap])
        caps = brief.relevant_capabilities(BRIEF, ROUTE, CATALOG)
        with self.assertRaises(brief.ConfigError):
            brief.normalize_proposal(dict(PROPOSAL, hook="Historia clínica disponible"), ROUTE, caps)

    def test_model_cannot_add_approvals_paths_or_shell(self):
        caps = brief.relevant_capabilities(BRIEF, ROUTE, CATALOG)
        for field, value in (("mediaApproved", True), ("shell", "echo test"), ("commercialProfile", "approved"),
                             ("brand", {}), ("media", {}), ("approveFinal", True), ("timing", {})):
            with self.subTest(field=field), self.assertRaises(brief.BriefError):
                brief.normalize_proposal(dict(PROPOSAL, **{field: value}), ROUTE, caps)

    def test_operator_controls_visual_style_and_director_notes_are_not_copy(self):
        caps = brief.relevant_capabilities(BRIEF, ROUTE, CATALOG)
        config, report = brief.normalize_proposal(PROPOSAL, ROUTE, caps, "premium")
        self.assertEqual(config["stylePreset"], "premium")
        self.assertEqual(report["stylePreset"], "premium")
        self.assertIn("NO son copy visible", brief.config_prompt(BRIEF, ROUTE, caps))
        for value in ("Usa mi video como apertura", "Muestra una pantalla de reservas", "Termina invitando a probar Citaya"):
            with self.subTest(value=value):
                with self.assertRaises(brief.BriefError) as ctx:
                    brief.normalize_proposal(dict(PROPOSAL, hook=value), ROUTE, caps)
                self.assertEqual(ctx.exception.code, "DIRECTOR_NOTE_IN_COPY")

    def test_invalid_json_duplicates_non_finite_and_arrays_rejected(self):
        for text in ('{"hook":"a","hook":"b"}', '{"x":NaN}', '{"x":Infinity}', '[]', 'not json'):
            with self.subTest(text=text), self.assertRaises(brief.BriefError):
                brief.parse_proposal(text)
        self.assertEqual(brief.parse_proposal('<think> </think>\n```json\n{"x":1}\n```'), {"x": 1})

    def test_http_errors_are_actionable_no_retry_no_body_leaks(self):
        for status in (400, 401, 502, 504):
            with self.subTest(status=status), gateway([(status, {"secret": "DO-NOT-ECHO"})]) as (url, requests):
                with self.assertRaises(brief.BriefError) as error:
                    self.generate(url)
                self.assertIn(f"HTTP {status}", str(error.exception))
                self.assertNotIn("DO-NOT-ECHO", str(error.exception))
                self.assertEqual(len(requests), 1)
                self.assertEqual(self.metrics()["status"], "failed")
                self.assertFalse(self.metrics()["usageComplete"])
                self.assertEqual(self.metrics()["errorCode"], f"HTTP_{status}")
                self.assertFalse((self.out / "generated-config.json").exists())

    def test_redirect_does_not_forward_authorization(self):
        with gateway([(302, {})]) as (url, requests):
            with self.assertRaises(brief.BriefError):
                self.generate(url)
        self.assertEqual(len(requests), 1)

    def test_timeout_sanitizes_exception(self):
        with patch.object(brief.urllib.request.OpenerDirector, "open", side_effect=TimeoutError("DO-NOT-ECHO")):
            with self.assertRaises(brief.BriefError) as error:
                self.generate("http://127.0.0.1:8787/v1/generate")
        self.assertNotIn("DO-NOT-ECHO", str(error.exception))
        self.assertEqual(self.metrics()["errorCode"], "GATEWAY_CONNECTION")

    def test_tool_calls_rejected_and_never_dispatched(self):
        reply = response(ROUTE, toolCalls=[{"name": "shell", "arguments": {"command": "DO-NOT-RUN"}}])
        with gateway([(200, reply)]) as (url, requests), patch.object(brief, "process") as process:
            with self.assertRaises(brief.BriefError):
                self.generate(url)
            process.assert_not_called()
        self.assertEqual(len(requests), 1)
        self.assertEqual(self.metrics()["totalTokens"], 150)
        self.assertEqual(self.metrics()["errorCode"], "UNEXPECTED_TOOLS")

    def test_two_invalid_configs_stop_and_preserve_metrics(self):
        bad = response(dict(PROPOSAL, capabilities=["factura_33"]))
        with gateway([(200, response(ROUTE)), (200, bad), (200, bad)]) as (url, requests):
            with self.assertRaises(brief.BriefError):
                self.generate(url)
        self.assertEqual(len(requests), 3)
        self.assertEqual(self.metrics()["status"], "failed")
        self.assertEqual(self.metrics()["totalTokens"], 450)
        self.assertFalse((self.out / "generated-config.json").exists())

    def test_missing_usage_is_marked_incomplete(self):
        with gateway([(200, response(ROUTE, usage=None)), (200, response(PROPOSAL))]) as (url, _):
            self.generate(url)
        self.assertFalse(self.metrics()["usageComplete"])
        self.assertEqual(self.metrics()["totalTokens"], 150)

    def test_explicit_narration_is_added_after_model_config(self):
        narration = "Tu próxima reserva empieza aquí."
        with gateway([(200, response(ROUTE)), (200, response(PROPOSAL))]) as (url, _):
            with contextlib.redirect_stdout(io.StringIO()):
                config, report = brief.generate_config(BRIEF+"\nLOCUCIÓN: "+narration+"\nVOZ: joven", url, "test-credential", brief.MODEL, self.out)
        self.assertEqual(config["audio"]["tts"]["text"], narration)
        self.assertEqual(report["ttsValidation"], "pending-synthesis")

    def test_duration_not_silently_defaulted_and_readability_gate(self):
        caps = brief.relevant_capabilities(BRIEF, ROUTE, CATALOG)
        config, report = brief.normalize_proposal(PROPOSAL, dict(ROUTE, durationSeconds=30), caps)
        self.assertEqual(report["duration"], 30)
        self.assertAlmostEqual(sum(s["duration"] for s in config["scenes"]), config["timing"]["demo"])
        with self.assertRaises(brief.ConfigError):
            brief.normalize_proposal(PROPOSAL, dict(ROUTE, durationSeconds=8), caps)
        for value in (True, -1, 121, "20"):
            with self.subTest(value=value), self.assertRaises(brief.BriefError):
                brief.validate_classification(dict(ROUTE, durationSeconds=value), CATALOG)

    def test_context_budget_rejects_oversize_without_network(self):
        with self.assertRaises(brief.BriefError):
            brief.check_brief("á" * 601)
        for stage in brief.OUTPUT_TOKENS:
            with self.assertRaises(brief.BriefError):
                brief.build_payload(brief.MODEL, stage, "x" * 3001)

    def test_credentials_blocked_before_persistence(self):
        for text in ("token=secret", "Bearer some-token", "sk-example", "test-credential"):
            with self.subTest(text=text), self.assertRaises(brief.BriefError):
                brief.check_brief(text, "test-credential")
        with gateway([(200, response(dict(ROUTE, extra="test-credential")))]) as (url, _):
            with self.assertRaises(brief.BriefError):
                self.generate(url)
        self.assertNotIn("test-credential", (self.out / "ai-usage.json").read_text())
        self.assertFalse((self.out / "classification.json").exists())

    def test_endpoint_validation(self):
        for url in ("http://192.168.1.20:8080/v1/chat/completions", "http://127.0.0.1:8787@evil.test/v1/generate", "https://user:secret@example.test/v1/generate", "https://example.test/v1/generate?token=x"):
            with self.subTest(url=url), self.assertRaises(brief.BriefError):
                brief.check_endpoint(url)
        brief.check_endpoint("http://127.0.0.1:8787/v1/generate")

    def test_cli_defaults_preview_and_config_only_never_spawns(self):
        for config_only in (False, True):
            with self.subTest(config_only=config_only), gateway([(200, response(ROUTE)), (200, response(PROPOSAL))]) as (url, _):
                env = {"CITAYA_AI_PROVIDER": "local", "CITAYA_AI_LOCAL_MODEL": brief.MODEL,
                       "CITAYA_AI_LOCAL_ENDPOINT": url, "CITAYA_AI_LOCAL_AUTH_TOKEN": "test-credential"}
                with patch.dict(os.environ, env, clear=True), patch.object(brief, "load_env", return_value={}), \
                     patch.object(brief, "ROOT", self.out), patch.object(brief, "catalog_context", return_value=CATALOG), \
                     patch.object(brief, "process") as process, contextlib.redirect_stdout(io.StringIO()):
                    brief.main((["--config-only"] if config_only else []) + [BRIEF])
                if config_only:
                    process.assert_not_called()
                else:
                    argv = process.call_args.args[0]
                    self.assertEqual(argv[-2:], ["--mode", "preview"])
                    self.assertNotIn("--approve-final", argv)
        for run in (self.out / "outputs/briefs").iterdir():
            self.assertEqual((run / "brief.txt").read_text(), BRIEF)
            self.assertTrue((run / "generated-config.json").is_file())

    def test_preview_subprocess_environment_contains_no_app_secrets(self):
        with patch.dict(os.environ, {"CITAYA_AI_LOCAL_AUTH_TOKEN": "test-credential", "OTHER_SECRET": "test-credential"}), \
             patch.object(subprocess, "run") as run:
            brief.process(["python3", "script.py"])
        self.assertNotIn("test-credential", json.dumps(run.call_args.kwargs["env"]))


if __name__ == "__main__":
    unittest.main()
