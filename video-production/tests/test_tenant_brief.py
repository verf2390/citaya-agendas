import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "scripts")]

import tenant_brief


class TenantBriefTests(unittest.TestCase):
    def test_builds_valid_custom_client_config_without_media(self):
        response = {
            "text": json.dumps({
                "hook": "Muestra tu negocio",
                "secondaryHook": "Una historia clara y breve",
                "benefit": "Presenta lo mejor de tu trabajo",
                "cta": "Conversemos",
            }),
            "toolCalls": [],
            "usage": {"inputTokens": 20, "outputTokens": 10, "totalTokens": 30},
        }
        env = {
            "CITAYA_AI_PROVIDER": "local",
            "CITAYA_AI_LOCAL_ENDPOINT": "http://127.0.0.1:8787/v1/generate",
            "CITAYA_AI_LOCAL_MODEL": "Qwen/Qwen3-4B-GGUF:Q4_K_M",
        }
        with patch.dict(os.environ, env, clear=False), patch.object(
            tenant_brief, "gateway_call", return_value=response
        ):
            config, report, usage = tenant_brief.generate_tenant_config(
                brief="Video corto mostrando nuestro trabajo real.",
                business_name="Negocio Demo",
                niche="local-business",
                niche_label="Software para reservas",
                style="dynamic",
                duration_seconds=15,
            )

        self.assertEqual(config["product"], "custom-client-video")
        self.assertEqual(config["brand"]["businessName"], "Negocio Demo")
        self.assertEqual(config["stylePreset"], "dynamic")
        self.assertFalse(config["mediaApproved"])
        self.assertEqual(report["duration"], 15)
        self.assertEqual(usage["totalTokens"], 30)

    def test_accepts_longer_creative_brief_and_custom_niche_label(self):
        response = {
            "text": json.dumps({
                "hook": "Tu negocio, más simple",
                "secondaryHook": "Agenda y gestión en un solo lugar",
                "benefit": "Muestra solo lo que necesitas",
                "cta": "Agenda una demo",
            }),
            "toolCalls": [],
            "usage": {"inputTokens": 100, "outputTokens": 20, "totalTokens": 120},
        }
        env = {
            "CITAYA_AI_PROVIDER": "local",
            "CITAYA_AI_LOCAL_ENDPOINT": "http://127.0.0.1:8787/v1/generate",
            "CITAYA_AI_LOCAL_MODEL": "Qwen/Qwen3-4B-GGUF:Q4_K_M",
        }
        long_brief = "Escena y dirección creativa. " * 120
        with patch.dict(os.environ, env, clear=False), patch.object(
            tenant_brief, "gateway_call", return_value=response
        ) as gateway:
            config, _, _ = tenant_brief.generate_tenant_config(
                brief=long_brief,
                business_name="Citaya",
                niche="local-business",
                niche_label="Software para reservas",
                style="dynamic",
                duration_seconds=15,
            )
        self.assertEqual(config["niche"], "local-business")
        sent = gateway.call_args.args[2]
        prompt = sent["input"][0]["text"]
        self.assertIn("Software para reservas", prompt)
        self.assertIn("Escena y dirección creativa", prompt)

    def test_rejects_secret_like_brief(self):
        with self.assertRaises(tenant_brief.TenantBriefError) as caught:
            tenant_brief.generate_tenant_config(
                brief="api_key=supersecret",
                business_name="Negocio Demo",
                niche="local-business",
                style="minimal",
                duration_seconds=15,
            )
        self.assertEqual(caught.exception.code, "UNSAFE_BRIEF")


if __name__ == "__main__":
    unittest.main()
