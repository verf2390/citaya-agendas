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
        self.assertNotIn("hook", config)
        self.assertNotIn("secondaryHook", config)
        self.assertNotIn("cta", config)
        self.assertEqual(config["stylePreset"], "dynamic")
        self.assertFalse(config["mediaApproved"])
        self.assertEqual(config["project"]["creativeBrief"], "Video corto mostrando nuestro trabajo real.")
        self.assertEqual(config["project"]["targetDurationSeconds"], 15)
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

    def test_director_preserves_full_intro_and_voice(self):
        response = {
            "text": json.dumps({
                "hook": "¿Pagas por funciones que no usas?",
                "secondaryHook": "Por eso creamos Citaya",
                "benefit": "Todo en un solo lugar",
                "cta": "Agenda una demo",
                "scenes": [
                    {"headline": "Agenda", "visualIntent": "agenda", "durationSeconds": 1.5},
                    {"headline": "Servicios", "visualIntent": "servicios", "durationSeconds": 1.1},
                    {"headline": "Clientes", "visualIntent": "clientes", "durationSeconds": 1.1},
                    {"headline": "Pagos y facturación", "visualIntent": "pagos_facturacion", "durationSeconds": 1.5},
                    {"headline": "Campañas", "visualIntent": "campanas", "durationSeconds": 1.2},
                ],
                "outroSeconds": 1.6,
            }),
            "toolCalls": [],
            "usage": {"inputTokens": 100, "outputTokens": 50, "totalTokens": 150},
        }
        env = {
            "CITAYA_AI_PROVIDER": "local",
            "CITAYA_AI_LOCAL_ENDPOINT": "http://127.0.0.1:8787/v1/generate",
            "CITAYA_AI_LOCAL_MODEL": "Qwen/Qwen3-4B-GGUF:Q4_K_M",
        }
        config = {
            "schemaVersion": 1,
            "product": "custom-client-video",
            "template": "creator-led-v1",
            "stylePreset": "dynamic",
            "niche": "local-business",
            "videoType": "promotion",
            "brand": {"businessName": "Citaya"},
            "capabilities": ["provided_business_content"],
            "hook": "Hook viejo",
            "secondaryHook": "Segundo viejo",
            "cta": "CTA viejo",
            "content": {
                "hook": "Hook",
                "secondaryHook": "Segundo",
                "benefit": "Beneficio",
                "cta": "CTA",
            },
            "media": {
                "creatorIntro": "asset:11111111-1111-1111-1111-111111111111",
                "clientVoiceover": "asset:22222222-2222-2222-2222-222222222222",
            },
            "creator": {
                "useClipAudio": True,
                "voiceoverStart": 2.5,
                "introVideo": "asset:11111111-1111-1111-1111-111111111111",
                "voiceover": "asset:22222222-2222-2222-2222-222222222222",
            },
            "mediaPolicy": {
                "useOnlyProvidedAssets": True,
                "allowStockMedia": False,
                "allowGeneratedMedia": False,
            },
            "mediaApproved": True,
            "timing": {"intro": 2.5, "demo": 10.5, "outro": 2},
            "project": {
                "creativeBrief": "Usa mi video completo al inicio y luego la locución.",
                "targetDurationSeconds": 15,
            },
        }
        assets = [
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "assetType": "video",
                "durationMs": 7210,
                "width": 1080,
                "height": 1920,
            },
            {
                "id": "22222222-2222-2222-2222-222222222222",
                "assetType": "audio",
                "durationMs": 7870,
                "width": None,
                "height": None,
            },
        ]
        with patch.dict(os.environ, env, clear=False), patch.object(
            tenant_brief, "gateway_call", return_value=response
        ):
            directed, report, usage = tenant_brief.direct_tenant_config(
                config=config,
                assets=assets,
            )

        self.assertEqual(directed["timing"]["intro"], 7.21)
        self.assertEqual(directed["creator"]["voiceoverStart"], 7.21)
        self.assertNotIn("hook", directed)
        self.assertNotIn("secondaryHook", directed)
        self.assertNotIn("cta", directed)
        self.assertNotIn("introVideo", directed["creator"])
        self.assertNotIn("voiceover", directed["creator"])
        self.assertGreaterEqual(report["plannedDurationSeconds"], 15.08)
        self.assertTrue(report["preservedMedia"])
        self.assertEqual(usage["totalTokens"], 150)
        self.assertEqual(
            [scene["headline"] for scene in directed["scenes"]],
            ["Agenda", "Servicios", "Clientes", "Pagos y facturación", "Campañas"],
        )
        self.assertEqual(
            [scene["mode"] for scene in directed["scenes"]],
            ["calendar", "service", "customers", "payments", "campaign-preview"],
        )
        self.assertAlmostEqual(
            sum(scene["duration"] for scene in directed["scenes"]),
            directed["timing"]["demo"],
            places=6,
        )


    def test_external_brand_cannot_request_citaya_product_ui(self):
        response = {
            "text": json.dumps({
                "hook": "Tu negocio",
                "secondaryHook": "Una propuesta clara",
                "benefit": "Muestra lo importante",
                "cta": "Conoce más",
                "scenes": [
                    {"headline": "Agenda", "visualIntent": "agenda", "durationSeconds": 3},
                ],
                "outroSeconds": 2,
            }),
            "toolCalls": [],
            "usage": {"inputTokens": 10, "outputTokens": 10, "totalTokens": 20},
        }
        config = {
            "schemaVersion": 1,
            "product": "custom-client-video",
            "template": "creator-led-v1",
            "stylePreset": "dynamic",
            "niche": "local-business",
            "videoType": "promotion",
            "brand": {"businessName": "Negocio Externo"},
            "capabilities": ["provided_business_content"],
            "content": {"hook": "Hook", "secondaryHook": "Segundo", "benefit": "Beneficio", "cta": "CTA"},
            "media": {},
            "creator": {"useClipAudio": True, "voiceoverStart": 0},
            "mediaPolicy": {"useOnlyProvidedAssets": True, "allowStockMedia": False, "allowGeneratedMedia": False},
            "mediaApproved": False,
            "timing": {"intro": 2, "demo": 11, "outro": 2},
            "project": {"creativeBrief": "Muestra una agenda.", "targetDurationSeconds": 15},
        }
        with patch.object(tenant_brief, "gateway_call", return_value=response):
            with self.assertRaises(tenant_brief.TenantBriefError) as caught:
                tenant_brief.direct_tenant_config(config=config, assets=[])
        self.assertEqual(caught.exception.code, "AI_INVALID_PROPOSAL")

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
