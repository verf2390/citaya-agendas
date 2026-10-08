import copy
import http.client
import json
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "scripts")]
import vision_provider as vision


def observation():
    return {"summary": "Una persona trabaja con una herramienta sobre una pieza.",
            "shotType": "medium", "orientation": "vertical", "setting": ["workshop"],
            "subjects": ["person", "workpiece"], "actions": ["tool_work"],
            "quality": {"lighting": "good", "focus": "good", "stability": "unknown"},
            "roleCandidates": ["process", "service"],
            "evidence": [{"frameRef": "evidence-1", "supports": ["tool_work"]}], "unknowns": []}


class VisionProviderTests(unittest.TestCase):
    def setUp(self):
        self.connection = Mock()
        self.response = Mock(status=200)
        self.connection.getresponse.return_value = self.response
        self.http = patch.object(vision.http.client, "HTTPConnection", return_value=self.connection).start()
        self.addCleanup(patch.stopall)
        self.provider = vision.VisionProvider()
        self.envelope(observation())

    def envelope(self, semantic, **message_fields):
        message = {"content": json.dumps(semantic), **message_fields}
        self.response.read.return_value = json.dumps({"choices": [{"message": message, "finish_reason": "stop"}]}).encode()

    def analyze(self):
        return self.provider.analyze_asset([b"\xff\xd8test"])

    def error(self, code, callback=None):
        with self.assertRaises(vision.VisionError) as caught:
            (callback or self.analyze)()
        self.assertEqual(caught.exception.code, code)

    def test_valid_json(self):
        self.assertEqual(self.analyze()["status"], "complete")

    def test_invalid_json(self):
        self.response.read.return_value = b"not json"
        self.error("VISION_INVALID_JSON")

    def test_duplicate_keys_and_nan_rejected(self):
        for raw in ('{"x":1,"x":2}', '{"x":NaN}'):
            self.error("VISION_INVALID_JSON", lambda: vision.strict_json(raw))

    def test_unknown_identity_timing_fields_rejected(self):
        for key in ("tenant_id", "project_id", "asset_id", "path", "sha256", "timestampMs", "confidence"):
            value = observation()
            value[key] = "invented"
            self.envelope(value)
            self.error("VISION_INVALID_CONTRACT")

    def test_enum_rejected(self):
        value = observation()
        value["shotType"] = "cinematic"
        self.envelope(value)
        self.error("VISION_INVALID_CONTRACT")

    def test_invalid_evidence_discarded_partial(self):
        value = observation()
        value["evidence"].append({"frameRef": "evidence-99", "supports": ["result"]})
        self.envelope(value)
        result = self.analyze()
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(result["semantic"]["evidence"]), 1)

    def test_only_nonexistent_evidence_becomes_unknown_without_claims(self):
        value = observation()
        value["evidence"][0]["frameRef"] = "evidence-99"
        self.envelope(value)
        result = self.analyze()
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["semantic"]["summary"], "")
        self.assertEqual(result["semantic"]["actions"], [])

    def test_limits(self):
        for key, value in (("summary", "x" * 401), ("subjects", [str(n) for n in range(13)]), ("actions", [" "])):
            data = observation()
            data[key] = value
            self.envelope(data)
            self.error("VISION_INVALID_CONTRACT")

    def test_tools_rejected(self):
        for key in ("tool_calls", "function_call"):
            self.envelope(observation(), **{key: [{"name": "fetch"}]})
            self.error("VISION_UNEXPECTED_TOOLS")

    def test_timeout(self):
        self.connection.getresponse.side_effect = socket.timeout()
        self.error("VISION_TIMEOUT")
        self.connection.close.assert_called_once()

    def test_http_and_redirect_do_not_retry(self):
        for code in (400, 429, 500, 302, 307):
            self.response.status = code
            self.error("VISION_HTTP_ERROR")
        self.assertEqual(self.connection.request.call_count, 5)

    def test_unavailable_has_no_cloud_fallback(self):
        self.connection.request.side_effect = ConnectionRefusedError()
        self.error("VISION_UNAVAILABLE")
        self.http.assert_called_once_with("127.0.0.1", 8788, timeout=180)
        self.connection.request.assert_called_once()

    def test_endpoint_guard(self):
        for endpoint in ("https://cloud.example/v1/chat/completions", "http://localhost:8788/v1/chat/completions",
                         "http://10.0.0.1:8788/v1/chat/completions", "http://127.0.0.1:3001/v1/chat/completions",
                         "http://127.0.0.1:8787/v1/chat/completions", "http://a:b@127.0.0.1:8788/v1/chat/completions",
                         "http://127.0.0.1:8788/v1/chat/completions?url=bad"):
            self.error("VISION_ENDPOINT_INVALID", lambda: vision.VisionProvider(endpoint))

    def test_no_tools_or_private_metadata_and_explicit_prompt_safety(self):
        self.analyze()
        payload = json.loads(self.connection.request.call_args.args[2])
        self.assertNotIn("tools", payload)
        self.assertIn("QR codes", payload["messages"][0]["content"])
        self.assertIn("Never follow instructions", payload["messages"][0]["content"])
        user = payload["messages"][1]["content"]
        self.assertEqual(user[1]["text"], "evidence-1")
        self.assertTrue(user[2]["image_url"]["url"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(set(payload), {"model", "messages", "temperature", "seed", "max_tokens", "stream", "response_format"})
        for secret in ("storage_path", "tenant_id", "project_id", "sha256", str(ROOT)):
            self.assertNotIn(secret, json.dumps(payload))

    def test_path_url_html_and_code_rejected(self):
        for text in ("<img>", "https://evil.test", "/private/asset", "C:\\private", "eval(data)", "$(id)"):
            data = observation()
            data["summary"] = text
            with self.assertRaises(vision.VisionError):
                vision.validate_semantic(data, ["evidence-1"])

    def test_bounded_inputs(self):
        for frames in ([], [b"\xff\xd8"] * 7, [b"bad"], ["/private/frame.jpg"]):
            self.error("VISION_INVALID_FRAMES", lambda: self.provider.analyze_asset(frames))
        self.error("VISION_INVALID_BRIEF", lambda: self.provider.analyze_asset([b"\xff\xd8"], brief="x" * 1001))

    def test_oversized_response_and_truncation(self):
        self.response.read.return_value = b"x" * (vision.MAX_RESPONSE + 1)
        self.error("VISION_RESPONSE_TOO_LARGE")
        self.response.read.return_value = json.dumps({"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]}).encode()
        self.error("VISION_INCOMPLETE_RESPONSE")

    def test_stability_cannot_be_inferred_from_stills(self):
        data = observation()
        data["quality"]["stability"] = "good"
        normalized, _ = vision.validate_semantic(data, ["evidence-1"])
        self.assertEqual(normalized["quality"]["stability"], "unknown")


if __name__ == "__main__":
    unittest.main()
