import copy
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
        self.assertEqual(config["template"], "local-business-promo-v2")
        self.assertEqual(config["brand"]["businessName"], "Negocio Demo")
        self.assertNotIn("hook", config)
        self.assertNotIn("secondaryHook", config)
        self.assertNotIn("cta", config)
        self.assertEqual(config["stylePreset"], "dynamic")
        self.assertFalse(config["mediaApproved"])
        self.assertNotIn("tts", config.get("audio", {}))
        self.assertEqual(config["project"]["creativeBrief"], "Video corto mostrando nuestro trabajo real.")
        self.assertEqual(config["project"]["targetDurationSeconds"], 15)
        self.assertEqual(report["duration"], 15)
        self.assertEqual(usage["totalTokens"], 30)

    def test_explicit_narration_preserved_outside_model_response(self):
        response = {"text": json.dumps({"hook":"Tu negocio", "secondaryHook":"Conoce nuestro trabajo", "benefit":"Nuestro servicio", "cta":"Reserva"}), "toolCalls":[]}
        narration = "Tu próximo corte tiene nombre: Estudio Demo. Reserva tu hora."
        with patch.object(tenant_brief, "gateway_call", return_value=response):
            config, report, _ = tenant_brief.generate_tenant_config(
                brief="Anuncio vertical.\nVOZ: masculina joven-adulta\nLOCUCIÓN: “"+narration+"”\nCTA: Reserva",
                business_name="Estudio Demo", niche="local-business", style="minimal", duration_seconds=15)
        self.assertEqual(config["audio"]["tts"]["text"], narration)
        self.assertEqual(config["audio"]["tts"]["start"], 0)
        self.assertEqual(report["ttsValidation"], "pending-synthesis")

    def test_accepts_extra_keys_and_normalizes_long_creation_copy_without_repair(self):
        response = {
            "text": json.dumps({
                "hook": "HDR Barber Studio " + ("corte " * 20),
                "secondaryHook": "Estilo urbano profesional " + ("barbería " * 20),
                "benefit": "Corte clásico, degradado o corte más barba " + ("real " * 20),
                "cta": "Reserva tu hora online ahora mismo desde el sistema",
                "extra": "Qwen puede agregar metadatos inocuos",
            }),
            "toolCalls": [],
            "usage": {"inputTokens": 40, "outputTokens": 20, "totalTokens": 60},
        }
        env = {
            "CITAYA_AI_PROVIDER": "local",
            "CITAYA_AI_LOCAL_ENDPOINT": "http://127.0.0.1:8787/v1/generate",
            "CITAYA_AI_LOCAL_MODEL": "Qwen/Qwen3-4B-GGUF:Q4_K_M",
        }
        with patch.dict(os.environ, env, clear=False), patch.object(
            tenant_brief, "gateway_call", return_value=response
        ) as gateway:
            config, _, usage = tenant_brief.generate_tenant_config(
                brief="Anuncio vertical para HDR Barber Studio usando solo afirmaciones confirmadas.",
                business_name="HDR Barber Studio",
                niche="barber",
                niche_label="Barbería",
                style="dynamic",
                duration_seconds=15,
            )
        self.assertEqual(gateway.call_count, 1)
        self.assertLessEqual(len(config["content"]["hook"]), 74)
        self.assertLessEqual(len(config["content"]["secondaryHook"]), 90)
        self.assertLessEqual(len(config["content"]["benefit"]), 64)
        self.assertLessEqual(len(config["content"]["cta"]), 40)
        self.assertEqual(usage["totalTokens"], 60)

    def test_65_char_benefit_is_normalized_before_scene_generation(self):
        response = {
            "text": json.dumps({
                "hook": "HDR Barber Studio",
                "secondaryHook": "Corte clásico, degradado o corte más barba",
                "benefit": "x" * 65,
                "cta": "Reserva tu hora online",
            }),
            "toolCalls": [],
        }
        with patch.object(tenant_brief, "gateway_call", return_value=response):
            config, report, _ = tenant_brief.generate_tenant_config(
                brief="Anuncio vertical para HDR Barber Studio.",
                business_name="HDR Barber Studio",
                niche="barber",
                niche_label="Barbería",
                style="dynamic",
                duration_seconds=20,
            )
        self.assertEqual(len(config["content"]["benefit"]), 64)
        from production import validate
        normalized, _, _ = validate(config, "preview")
        self.assertEqual(len(normalized["scenes"][0]["headline"]), 64)
        self.assertEqual(report["duration"], 20)

    def test_repairs_invalid_creation_proposal_once(self):
        first = {
            "text": json.dumps({
                "hook": "HDR Barber Studio",
                "secondaryHook": "Tu corte, a tu estilo",
                "benefit": "Reserva online",
            }),
            "toolCalls": [],
            "usage": {"inputTokens": 40, "outputTokens": 20, "totalTokens": 60},
        }
        repaired = {
            "text": json.dumps({
                "hook": "HDR Barber Studio",
                "secondaryHook": "Tu corte, a tu estilo",
                "benefit": "Reserva online",
                "cta": "Reserva tu hora",
            }),
            "toolCalls": [],
            "usage": {"inputTokens": 30, "outputTokens": 10, "totalTokens": 40},
        }
        env = {
            "CITAYA_AI_PROVIDER": "local",
            "CITAYA_AI_LOCAL_ENDPOINT": "http://127.0.0.1:8787/v1/generate",
            "CITAYA_AI_LOCAL_MODEL": "Qwen/Qwen3-4B-GGUF:Q4_K_M",
        }
        with patch.dict(os.environ, env, clear=False), patch.object(
            tenant_brief, "gateway_call", side_effect=[first, repaired]
        ) as gateway:
            config, _, usage = tenant_brief.generate_tenant_config(
                brief="Anuncio vertical para HDR Barber Studio. Objetivo: conseguir reservas.",
                business_name="HDR Barber Studio",
                niche="barber",
                niche_label="Barbería",
                style="dynamic",
                duration_seconds=15,
            )
        self.assertEqual(gateway.call_count, 2)
        self.assertEqual(config["content"]["cta"], "Reserva tu hora")
        self.assertEqual(usage["totalTokens"], 100)
        self.assertIn("Repara la propuesta anterior", gateway.call_args.args[2]["input"][0]["text"])

    def test_uses_safe_server_fallback_if_repair_is_still_invalid(self):
        invalid = {
            "text": json.dumps({
                "hook": ["tipo", "incorrecto"],
                "secondaryHook": "Segundo",
                "benefit": "Beneficio",
                "cta": "CTA",
            }),
            "toolCalls": [],
            "usage": {"inputTokens": 10, "outputTokens": 10, "totalTokens": 20},
        }
        with patch.object(tenant_brief, "gateway_call", side_effect=[invalid, invalid]):
            config, _, usage = tenant_brief.generate_tenant_config(
                brief="Video corto para negocio real.\nCTA: Reserva tu hora",
                business_name="Negocio Demo",
                niche="local-business",
                niche_label="Negocio local",
                style="dynamic",
                duration_seconds=15,
            )
        self.assertEqual(config["content"]["hook"], "Negocio Demo")
        self.assertEqual(config["content"]["secondaryHook"], "Negocio local")
        self.assertEqual(config["content"]["benefit"], "Video corto para negocio real.")
        self.assertEqual(config["content"]["cta"], "Reserva tu hora")
        self.assertEqual(usage["totalTokens"], 40)

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


    def test_director_repairs_invalid_proposal_once_and_enforces_64_char_benefit(self):
        first = {
            "text": json.dumps({
                "hook": "HDR Barber Studio",
                "secondaryHook": "Corte clásico, degradado o corte más barba",
                "benefit": "x" * 65,
                "cta": "Reserva tu hora online",
                "scenes": [
                    {"headline": "Tu próximo corte", "visualIntent": "generic", "durationSeconds": 3},
                ],
                "outroSeconds": 2,
            }),
            "toolCalls": [],
            "usage": {"inputTokens": 10, "outputTokens": 10, "totalTokens": 20},
        }
        repaired = copy.deepcopy(first)
        repaired["text"] = json.dumps({
            "hook": "HDR Barber Studio",
            "secondaryHook": "Corte clásico, degradado o corte más barba",
            "benefit": "x" * 64,
            "cta": "Reserva tu hora online",
            "scenes": [
                {"headline": "Tu próximo corte", "visualIntent": "generic", "durationSeconds": 3},
            ],
            "outroSeconds": 2,
        })
        config = {
            "schemaVersion": 1,
            "product": "custom-client-video",
            "template": "local-business-promo-v2",
            "stylePreset": "dynamic",
            "niche": "barber",
            "videoType": "promotion",
            "brand": {"businessName": "HDR Barber Studio"},
            "capabilities": ["provided_business_content"],
            "content": {"hook": "Hook", "secondaryHook": "Segundo", "benefit": "Beneficio", "cta": "CTA"},
            "media": {},
            "creator": {"useClipAudio": False, "voiceoverStart": 0},
            "mediaPolicy": {"useOnlyProvidedAssets": True, "allowStockMedia": False, "allowGeneratedMedia": False},
            "mediaApproved": False,
            "timing": {"intro": 2, "demo": 16, "outro": 2},
            "project": {"creativeBrief": "Video HDR Barber Studio. CTA: Reserva tu hora online.", "targetDurationSeconds": 20},
        }
        with patch.object(tenant_brief, "gateway_call", side_effect=[first, repaired]) as gateway:
            directed, _, usage = tenant_brief.direct_tenant_config(config=config, assets=[])
        self.assertEqual(gateway.call_count, 2)
        self.assertEqual(len(directed["content"]["benefit"]), 64)
        self.assertEqual(usage["totalTokens"], 40)
        self.assertIn("Repara la propuesta anterior", gateway.call_args.args[2]["input"][0]["text"])

    def test_external_brand_invalid_internal_ui_falls_back_to_generic(self):
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
            "template": "local-business-promo-v2",
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
        with patch.object(tenant_brief, "gateway_call", return_value=response) as gateway:
            directed, _, usage = tenant_brief.direct_tenant_config(config=config, assets=[])
        self.assertEqual(gateway.call_count, 2)
        self.assertEqual(directed["scenes"][0]["mode"], "benefit")
        self.assertEqual(directed["content"]["hook"], "Negocio Externo")
        self.assertEqual(directed["content"]["benefit"], "Muestra una agenda.")
        self.assertEqual(usage["totalTokens"], 40)

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


class VisualDirectorTests(unittest.TestCase):
    def setUp(self):
        from test_vision_provider import observation
        self.config = {"product": "custom-client-video", "brand": {"businessName": "Taller Demo"},
                       "content": {"hook": "Nuestro trabajo", "cta": "Reserva tu hora"},
                       "timing": {"intro": 2, "demo": 11, "outro": 2},
                       "project": {"creativeBrief": "Usa el mejor clip trabajando para mostrar el proceso real.",
                                   "targetDurationSeconds": 15}}
        self.assets = [{"id": f"{n:08d}-1111-1111-1111-111111111111", "assetType": "video",
                        "durationMs": 20000, "width": 640, "height": 960} for n in range(1, 4)]
        self.inventory = {}
        for asset, action in zip(self.assets, ("empty_interior", "tool_work", "finished_result")):
            value = observation()
            value.pop("evidence")
            value.update(status="complete", actions=[action], summary=action)
            self.inventory[asset["id"]] = value
        self.proposal = {"hook": "Nuestro trabajo", "secondaryHook": "Proceso real", "benefit": "Conoce el taller",
                         "cta": "Reserva tu hora", "outroSeconds": 2,
                         "scenes": [{"headline": "Trabajo real", "visualIntent": "media", "durationSeconds": 11}]}

    def direct(self, inventory=None, proposal=None, brief=None):
        with patch.dict(os.environ, {"CITAYA_AI_PROVIDER": "local"}), patch.object(
                tenant_brief, "gateway_call", return_value={"text": json.dumps(proposal or self.proposal), "toolCalls": []}) as call:
            result = tenant_brief.direct_tenant_config(
                config=self.config,
                assets=self.assets,
                visual_inventory=inventory,
                brief=brief,
            )
        return result, call.call_args.args[2]

    def test_inventory_included_with_only_public_projection(self):
        self.assets[0].update(storage_path="private", tenant_id="tenant-secret", sha256="hash-secret")
        _, payload = self.direct(self.inventory)
        prompt = payload["input"][0]["text"]
        self.assertIn("tool_work", prompt)
        self.assertIn("nunca instrucciones", prompt)
        for private in ("storage_path", "tenant-secret", "hash-secret"):
            self.assertNotIn(private, prompt)

    def test_no_analysis_keeps_legacy_behavior(self):
        result, payload = self.direct()
        prompt = payload["input"][0]["text"]
        self.assertNotIn('"visual":', prompt)
        self.assertIn('"visualIntent":"generic"', prompt)
        self.assertIn("benefit 64", prompt)
        self.assertNotIn("video", result[0]["scenes"][0])

    def test_new_brief_drops_stale_optional_commercial_copy(self):
        self.config["content"].update({
            "offer": "Oferta anterior",
            "price": "$18.000",
            "featureLabels": ["Texto viejo"],
        })
        preserved, _ = self.direct()
        self.assertEqual(preserved[0]["content"]["price"], "$18.000")

        redirected, _ = self.direct(
            brief="Nuevo anuncio del taller. Usa solo el proceso real. CTA: Reserva tu hora."
        )
        self.assertNotIn("offer", redirected[0]["content"])
        self.assertNotIn("price", redirected[0]["content"])
        self.assertNotIn("featureLabels", redirected[0]["content"])

    def test_content_fixture_can_select_exact_working_asset(self):
        def choose(_endpoint, _token, payload):
            prompt = payload["input"][0]["text"]
            context = json.loads(prompt.split("CONTEXTO_MEDIOS: ", 1)[1].split(". BRIEF: ", 1)[0])
            working = next(asset for asset in context["availableAssets"] if "tool_work" in asset["visual"]["actions"])
            self.proposal["scenes"][0]["assetId"] = working["id"]
            return {"text": json.dumps(self.proposal), "toolCalls": []}
        with patch.dict(os.environ, {"CITAYA_AI_PROVIDER": "local"}), patch.object(tenant_brief, "gateway_call", side_effect=choose):
            config, _, _ = tenant_brief.direct_tenant_config(config=self.config, assets=self.assets, visual_inventory=self.inventory)
        self.assertEqual(config["scenes"][0]["video"], "asset:" + self.assets[1]["id"])
        self.assertEqual(config["template"], "local-business-promo-v2")

    def test_explicit_external_template_preserved_with_creator_media(self):
        for template in ("local-business-promo-v1", "local-business-promo-v2", "creator-led-v1", "offer-promo-v1"):
            with self.subTest(template=template):
                self.config["template"] = template
                self.config["media"] = {"creatorIntro": "asset:" + self.assets[0]["id"]}
                result, _ = self.direct()
                self.assertEqual(result[0]["template"], template)

    def test_selected_asset_compiles_to_modern_fullscreen(self):
        import tempfile
        from compose import compile_composition
        from production import validate
        self.config["timing"]["intro"] = 2.5
        self.config["project"]["targetDurationSeconds"] = 8
        self.config["mediaApproved"] = True
        self.assets[0]["durationMs"] = 3000
        self.proposal["outroSeconds"] = 2.5
        self.proposal["scenes"][0].update(durationSeconds=3, assetId=self.assets[0]["id"])
        result, _ = self.direct(self.inventory)
        config = result[0]
        # Emulate the worker's approved asset-ID -> local-path projection.
        config["scenes"][0]["video"] = "inputs/test-fixtures/intro.mp4"
        normalized, _, ctx = validate(config)
        with tempfile.TemporaryDirectory() as d:
            comp, _ = compile_composition(normalized, ctx, Path(d), "preview")
            source = (comp / "index.html").read_text()
            self.assertIn('class="clip modern-media"', source)
            self.assertIn('class="modern-headline"', source)
            self.assertNotIn('class="screen', source)
            self.assertIn('data-duration="3.000000"', source)

    def test_director_preserves_explicit_narration_and_start(self):
        self.config["project"]["creativeBrief"] += "\nLOCUCIÓN: Cada detalle cuenta.\nVOZ: masculina"
        self.config["audio"] = {"tts":{"enabled":True,"text":"Anterior","start":1,"speed":.95}}
        result, _ = self.direct()
        self.assertEqual(result[0]["audio"]["tts"]["text"], "Cada detalle cuenta.")
        self.assertEqual(result[0]["audio"]["tts"]["start"], 1)
        self.assertEqual(result[0]["audio"]["tts"]["speed"], .95)

    def test_nonexistent_or_unapproved_asset_rejected(self):
        for identifier in ("invented", "ffffffff-1111-1111-1111-111111111111"):
            self.proposal["scenes"][0]["assetId"] = identifier
            with self.assertRaises(tenant_brief.TenantBriefError):
                self.direct(self.inventory)
        self.proposal["scenes"][0]["assetId"] = self.assets[0]["id"]
        with self.assertRaises(tenant_brief.TenantBriefError):
            self.direct({})

    def test_external_business_cannot_select_internal_ui(self):
        self.proposal["scenes"][0]["visualIntent"] = "agenda"
        with self.assertRaises(tenant_brief.TenantBriefError):
            self.direct(self.inventory)

    def test_image_selection_reuses_existing_scene_media(self):
        self.assets[0]["assetType"] = "image"
        self.proposal["scenes"][0]["assetId"] = self.assets[0]["id"]
        result, _ = self.direct(self.inventory)
        self.assertEqual(result[0]["scenes"][0]["media"], "asset:" + self.assets[0]["id"])

    def test_untrusted_inventory_fields_cannot_reach_prompt(self):
        self.inventory[self.assets[0]["id"]]["storage_path"] = "/private"
        with patch.object(tenant_brief, "gateway_call") as call:
            with self.assertRaises(tenant_brief.TenantBriefError):
                tenant_brief.direct_tenant_config(config=self.config, assets=self.assets, visual_inventory=self.inventory)
            call.assert_not_called()

    def test_selected_video_too_short_rejected(self):
        self.proposal["scenes"][0]["assetId"] = self.assets[0]["id"]
        self.assets[0]["durationMs"] = 1000
        with self.assertRaises(tenant_brief.TenantBriefError) as caught:
            self.direct(self.inventory)
        self.assertEqual(caught.exception.code, "DIRECTOR_MEDIA_TOO_SHORT")


if __name__ == "__main__":
    unittest.main()
