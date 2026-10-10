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
        result = self.analyze()
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["inferenceAttempts"], 1)
        self.connection.request.assert_called_once()

    def test_long_evidence_support_is_truncated_before_strict_validation(self):
        value = observation()
        claim = "La imagen muestra arquitectura y una portada con proyectos visibles."
        value["evidence"][0]["supports"] = [claim]
        self.envelope(value)
        result = self.analyze()
        self.assertEqual(result["semantic"]["evidence"], [
            {"frameRef": "evidence-1", "supports": [claim[:60]]}])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["inferenceAttempts"], 1)
        vision.VALIDATOR.validate(result["semantic"])

    def test_duplicate_setting_preserves_first_occurrence_order(self):
        value = observation()
        value["setting"] = ["architecture", "interior", "architecture", "exterior", "interior"]
        self.envelope(value)
        self.assertEqual(self.analyze()["semantic"]["setting"], ["architecture", "interior", "exterior"])

    def test_duplicate_roles_preserve_enums_and_order(self):
        value = observation()
        value["roleCandidates"] = ["service", "process", "service", "branding", "process"]
        self.envelope(value)
        self.assertEqual(self.analyze()["semantic"]["roleCandidates"], ["service", "process", "branding"])

    def test_real_contract_failures_normalize_together_without_retry(self):
        value = observation()
        value["evidence"][0]["supports"] = ["Visible architectural project details " * 3]
        value["setting"] = ["architecture", "architecture"]
        value["roleCandidates"] = ["service", "service"]
        self.assertEqual({error.validator for error in vision.VALIDATOR.iter_errors(value)},
                         {"maxLength", "uniqueItems"})
        original = copy.deepcopy(value)
        self.envelope(value)
        result = self.analyze()
        expected = copy.deepcopy(original)
        expected["evidence"][0]["supports"][0] = original["evidence"][0]["supports"][0][:60]
        expected["setting"] = ["architecture"]
        expected["roleCandidates"] = ["service"]
        self.assertEqual(result["semantic"], expected)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["inferenceAttempts"], 1)
        self.connection.request.assert_called_once()
        vision.VALIDATOR.validate(result["semantic"])
        self.assertEqual(value, original)
        self.assertEqual(vision._normalize_observation(expected), expected)

    def test_only_declared_text_fields_are_bounded_and_deduplicated_after_truncation(self):
        value = observation()
        value["summary"] = "á" * 401
        for field, limit in (("setting", 60), ("subjects", 60), ("actions", 60), ("unknowns", 140)):
            value[field] = ["ñ" * limit + "a", "ñ" * limit + "b", "otro", "otro"]
        value["evidence"][0]["supports"] = ["é" * 61, "é" * 60, "otro", "otro"]
        self.envelope(value)
        result = self.analyze()
        self.assertEqual(result["semantic"]["summary"], "á" * 400)
        for field, limit in (("setting", 60), ("subjects", 60), ("actions", 60), ("unknowns", 140)):
            self.assertEqual(result["semantic"][field], ["ñ" * limit, "otro"])
        self.assertEqual(result["semantic"]["evidence"][0]["supports"], ["é" * 60, "otro"])
        self.assertEqual(result["status"], "partial")
        vision.VALIDATOR.validate(result["semantic"])

    def test_normalization_never_repairs_other_contract_violations(self):
        for invalid in ("enum", "frame_ref", "extra", "nested_extra", "type", "missing", "count"):
            with self.subTest(invalid=invalid):
                value = observation()
                value["summary"] = "x" * 401
                value["setting"] = ["architecture", "architecture"]
                if invalid == "enum":
                    value["roleCandidates"] = ["SERVICE", "SERVICE"]
                elif invalid == "frame_ref":
                    value["evidence"][0]["frameRef"] = " evidence-1 "
                elif invalid == "extra":
                    value["unexpected"] = "invented"
                elif invalid == "nested_extra":
                    value["evidence"][0]["unexpected"] = "invented"
                elif invalid == "type":
                    value["setting"] = [1, 1]
                elif invalid == "missing":
                    del value["quality"]
                elif invalid == "count":
                    value["subjects"] = [str(n) for n in range(13)]
                self.envelope(value)
                self.error("VISION_INVALID_CONTRACT")

    def test_truncation_does_not_hide_unsafe_suffixes(self):
        for tail, code in ((" eval(data)", "VISION_UNSAFE_TEXT"),
                           ("<img>", "VISION_INVALID_CONTRACT"),
                           ("/private/asset", "VISION_INVALID_CONTRACT")):
            with self.subTest(tail=tail):
                value = observation()
                value["summary"] = "x" * 400 + tail
                self.envelope(value)
                self.error(code)

    def test_persisted_semantic_validation_remains_strict(self):
        value = observation()
        value["summary"] = "x" * 401
        self.error("VISION_INVALID_CONTRACT", lambda: vision.validate_semantic(value, ["evidence-1"]))

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
        for key, value in (("subjects", [str(n) for n in range(13)]), ("actions", [" "])):
            data = observation()
            data[key] = value
            self.envelope(data)
            self.error("VISION_INVALID_CONTRACT")

    def test_tools_rejected(self):
        for key in ("tool_calls", "function_call"):
            self.connection.reset_mock()
            self.envelope(observation(), **{key: [{"name": "fetch"}]})
            self.error("VISION_UNEXPECTED_TOOLS")
            self.connection.request.assert_called_once()

    def test_timeout(self):
        self.connection.getresponse.side_effect = socket.timeout()
        self.error("VISION_TIMEOUT")
        self.connection.close.assert_called_once()
        self.connection.request.assert_called_once()

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
        self.assertEqual(payload["response_format"], {"type": "json_object", "schema": vision.SCHEMA})
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

    def test_invalid_contract_then_valid_retries_same_frames_without_invalid_output(self):
        valid = self.response.read.return_value
        invalid = observation()
        invalid["private_invalid_marker"] = "do not echo this response"
        self.envelope(invalid)
        self.response.read.side_effect = [self.response.read.return_value, valid]
        result = self.analyze()
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["inferenceAttempts"], 2)
        self.assertEqual(self.connection.request.call_count, 2)
        first, second = [json.loads(call.args[2]) for call in self.connection.request.call_args_list]
        self.assertEqual(first["messages"][1], second["messages"][1])
        self.assertEqual(second["messages"][0]["content"], vision.SYSTEM + vision.RETRY_INSTRUCTION)
        self.assertEqual(len(second["messages"]), 2)
        self.assertNotIn("private_invalid_marker", json.dumps(second))
        self.assertNotIn("tools", second)
        self.assertEqual(first["model"], second["model"])

    def test_two_invalid_contracts_fail_without_third_attempt(self):
        valid = self.response.read.return_value
        self.envelope({})
        invalid = self.response.read.return_value
        self.response.read.side_effect = [invalid, invalid, valid]
        with self.assertRaises(vision.VisionError) as caught:
            self.analyze()
        self.assertEqual(caught.exception.code, "VISION_INVALID_CONTRACT")
        self.assertEqual(caught.exception.inference_attempts, 2)
        self.assertEqual(self.connection.request.call_count, 2)

    def test_other_retryable_response_errors_can_recover(self):
        valid = self.response.read.return_value
        invalid_responses = [b"not JSON", b'{}', json.dumps({"choices": [
            {"message": {"content": "{}"}, "finish_reason": "length"}]}).encode()]
        for invalid in invalid_responses:
            with self.subTest(invalid=invalid):
                self.connection.reset_mock()
                self.response.read.side_effect = [invalid, valid]
                self.assertEqual(self.analyze()["inferenceAttempts"], 2)
                self.assertEqual(self.connection.request.call_count, 2)

    def test_unsafe_text_does_not_retry(self):
        value = observation()
        value["summary"] = "eval(data)"
        self.envelope(value)
        self.error("VISION_UNSAFE_TEXT")
        self.connection.request.assert_called_once()

    def test_retry_allowlist_excludes_authorization_and_integrity_errors(self):
        for code in ("LEASE_EXPIRED", "ASSET_INTEGRITY", "ANALYSIS_EVIDENCE_MISMATCH",
                     "VISION_RESPONSE_TOO_LARGE"):
            with self.subTest(code=code), patch.object(self.provider, "_infer", side_effect=vision.VisionError(code)) as infer:
                self.error(code)
                infer.assert_called_once()

    def test_second_failure_preserves_its_error(self):
        with patch.object(self.provider, "_infer", side_effect=[
                vision.VisionError("VISION_INVALID_JSON"), vision.VisionError("VISION_TIMEOUT")]) as infer:
            with self.assertRaises(vision.VisionError) as caught:
                self.analyze()
            self.assertEqual(caught.exception.code, "VISION_TIMEOUT")
            self.assertEqual(caught.exception.inference_attempts, 2)
            self.assertEqual(infer.call_count, 2)


if __name__ == "__main__":
    unittest.main()
