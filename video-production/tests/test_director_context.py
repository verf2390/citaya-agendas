"""Visual authorization is independent of bounded, textual model context."""
import copy
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'scripts')]
import analysis_worker
import bridge
import tenant_brief
from production import ConfigError, schema_validate, tenant_schema_validate
from studio import Actor, Studio
from test_analysis_worker import FakeProvider
from test_vision_provider import observation

COPY = {'hook': 'Una web con identidad', 'secondaryHook': 'Diseño real',
        'benefit': 'Nuestro proyecto', 'cta': 'Hablemos'}


def large_observation():
    value = observation()
    value['summary'] = ('Website homepage and portfolio observed. ' * 10)[:400]
    for key in ('subjects', 'actions', 'setting'):
        value[key] = [(key + ' website ' + str(n) + ' ' + 'detail ' * 10)[:60] for n in range(4)]
    value['evidence'][0]['supports'] = value['actions']
    return value


def config_for(ids):
    config = {'product': 'custom-client-video', 'template': 'local-business-promo-v2',
            'videoType': 'website_showcase', 'brand': {'businessName': 'CITAYA'},
            'content': dict(COPY), 'mediaPolicy': {'mediaFirst': True}, 'mediaApproved': True,
            'project': {'creativeBrief': 'Muestra el sitio real.', 'productContext': 'external',
                        'targetDurationSeconds': 20},
            'timing': {'intro': 2.5, 'demo': 15, 'outro': 2.5},
            'media': {'images': ['asset:' + aid for aid in ids[:12]],
                      'screenshots': ['asset:' + aid for aid in ids[12:24]]}}
    # Each media array already has a 12-item schema limit. Additional selected
    # screenshots can live in existing scene roles, without relaxing the schema.
    remaining = ids[24:]
    if remaining:
        config['scenes'] = [{'mode': 'media', 'capability': 'provided_business_content',
                             'headline': COPY['hook'], 'duration': 1, 'media': 'asset:' + remaining[n],
                             'afterMedia': 'asset:' + remaining[min(n + 1, len(remaining) - 1)]}
                            for n in range(0, len(remaining), 2)]
    return config


def proposal(asset_id):
    return {'text': json.dumps({**COPY, 'outroSeconds': 2.5, 'scenes': [
        {'headline': COPY['hook'], 'visualIntent': 'media', 'durationSeconds': 3,
         'assetId': asset_id}]}), 'toolCalls': []}


def prompt_context(payload):
    raw = payload['input'][0]['text'].split('CONTEXTO_MEDIOS: ', 1)[1].split('. BRIEF: ', 1)[0]
    return raw, json.loads(raw)


class DirectorContextTests(unittest.TestCase):
    def setUp(self):
        self.ids = [str(uuid.UUID(int=n)) for n in range(1, 41)]
        self.assets = [{'id': aid, 'assetType': 'image', 'durationMs': 0, 'width': 144, 'height': 256}
                       for aid in self.ids]
        self.inventory = {}
        for aid in self.ids:
            value = large_observation()
            value.pop('evidence')
            self.inventory[aid] = {**value, 'status': 'complete'}
        self.config = config_for(self.ids)

    def direct(self, response=None, assets=None, inventory=None):
        with patch.object(tenant_brief, 'gateway_call', return_value=response or proposal(self.ids[-1])) as model:
            result = tenant_brief.direct_tenant_config(config=self.config,
                assets=self.assets if assets is None else assets,
                visual_inventory=self.inventory if inventory is None else inventory)
        return result, model.call_args.args[2]

    def test_small_context_preserves_all_exposed_ids_and_rich_observations(self):
        self.config = config_for(self.ids[:2])
        (_, report, _), payload = self.direct(proposal(self.ids[1]), assets=self.assets[:2])
        raw, context = prompt_context(payload)
        self.assertLessEqual(len(raw), tenant_brief.MAX_VISUAL_CONTEXT_CHARS)
        self.assertEqual([a['id'] for a in context['availableAssets']], self.ids[:2])
        self.assertEqual(context['availableAssets'][0]['visual']['subjects'], self.inventory[self.ids[0]]['subjects'])
        self.assertIn('quality', context['availableAssets'][0]['visual'])
        self.assertTrue(report['mediaFirst'])

    def test_forty_valid_images_fit_without_losing_identities(self):
        schema_validate(self.config)
        tenant_schema_validate(self.config)
        original = copy.deepcopy(self.inventory)
        inventory = tenant_brief._director_visual_inventory(self.inventory)
        old_rows = [{**a, 'visual': inventory[a['id']]} for a in self.assets]
        self.assertGreater(len(json.dumps(old_rows)), tenant_brief.MAX_VISUAL_CONTEXT_CHARS)
        (directed, _, _), payload = self.direct()
        raw, context = prompt_context(payload)
        self.assertLessEqual(len(raw), tenant_brief.MAX_VISUAL_CONTEXT_CHARS)
        self.assertEqual([a['id'] for a in context['availableAssets']], self.ids)
        for asset in context['availableAssets']:
            self.assertEqual(asset['visual']['status'], 'complete')
            self.assertEqual(asset['visual']['orientation'], 'vertical')
            self.assertEqual(asset['visual']['subjects'], self.inventory[asset['id']]['subjects'][:1])
            self.assertEqual((asset['width'], asset['height']), (144, 256))
        self.assertEqual(directed['scenes'][0]['media'], 'asset:' + self.ids[-1])
        self.assertTrue(all(s['mode'] == 'media' for s in directed['scenes']))
        self.assertEqual(self.inventory, original)
        schema_validate(directed)
        tenant_schema_validate(directed)

    def test_large_website_and_agenda_contexts_are_deterministic_and_never_use_product_ui(self):
        for video_type, product_context in (('website_showcase', 'external'), ('promotion', 'citaya-agendas')):
            self.config.update(videoType=video_type)
            self.config['project']['productContext'] = product_context
            (first, _, _), first_payload = self.direct()
            (second, _, _), second_payload = self.direct(inventory=dict(reversed(list(self.inventory.items()))))
            self.assertEqual(first_payload, second_payload)
            self.assertEqual(first, second)
            self.assertEqual(first['template'], 'website-showcase-v2' if video_type == 'website_showcase' else 'local-business-promo-v2')
            self.assertTrue(all(s['mode'] == 'media' for s in first['scenes']))

    def test_missing_or_unknown_real_analysis_fails_before_model_even_in_large_context(self):
        for unknown in (False, True):
            inventory = copy.deepcopy(self.inventory)
            if unknown:
                inventory[self.ids[-1]]['status'] = 'unknown'
            else:
                inventory.pop(self.ids[-1])
            with self.subTest(unknown=unknown), patch.object(tenant_brief, 'gateway_call') as model:
                with self.assertRaises(tenant_brief.TenantBriefError) as error:
                    tenant_brief.direct_tenant_config(config=self.config, assets=self.assets, visual_inventory=inventory)
                self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
                model.assert_not_called()

    def test_authorized_but_unexposed_and_invented_ids_are_not_selectable(self):
        # Inventory can include previously approved assets which the editor has
        # not selected. The bridge only exposes metadata for the selected set.
        self.config = config_for(self.ids[:2])
        for aid in (self.ids[-1], str(uuid.UUID(int=999))):
            with self.subTest(asset_id=aid), patch.object(tenant_brief, 'gateway_call', return_value=proposal(aid)) as model:
                with self.assertRaises(tenant_brief.TenantBriefError) as error:
                    tenant_brief.direct_tenant_config(config=self.config, assets=self.assets[:2], visual_inventory=self.inventory)
                self.assertEqual(error.exception.code, 'DIRECTOR_MEDIA_INVALID')
                _, context = prompt_context(model.call_args.args[2])
                self.assertNotIn(aid, {a['id'] for a in context['availableAssets']})

    def test_context_capacity_failure_is_honest_and_never_calls_model(self):
        assets = [{**self.assets[0], 'id': str(uuid.UUID(int=n))} for n in range(1, 201)]
        inventory = {a['id']: self.inventory[self.ids[0]] for a in assets}
        config = config_for([a['id'] for a in assets[:40]])
        schema_validate(config)
        with patch.object(tenant_brief, 'gateway_call') as model:
            with self.assertRaises(tenant_brief.TenantBriefError) as error:
                tenant_brief.direct_tenant_config(config=config,
                    assets=assets, visual_inventory=inventory)
            self.assertEqual(error.exception.code, 'DIRECTOR_CONTEXT_TOO_LARGE')
            model.assert_not_called()

    def test_missing_metadata_is_not_misreported_as_missing_analysis(self):
        with patch.object(tenant_brief, 'gateway_call') as model:
            with self.assertRaises(tenant_brief.TenantBriefError) as error:
                tenant_brief.direct_tenant_config(config=self.config, assets=self.assets[:-1], visual_inventory=self.inventory)
            self.assertEqual(error.exception.code, 'DIRECTOR_MEDIA_INVALID')
            model.assert_not_called()

    def test_full_inventory_guards_still_inspect_entries_after_old_context_limit(self):
        for field, value in (('storage_path', 'private'), ('summary', 'https://evil.test')):
            inventory = copy.deepcopy(self.inventory)
            inventory[self.ids[-1]][field] = value
            with self.subTest(field=field), patch.object(tenant_brief, 'gateway_call') as model:
                with self.assertRaises(tenant_brief.TenantBriefError) as error:
                    tenant_brief.direct_tenant_config(config=self.config, assets=self.assets, visual_inventory=inventory)
                self.assertEqual(error.exception.code, 'DIRECTOR_MEDIA_INVALID')
                model.assert_not_called()

    def test_repair_call_exposes_the_same_bounded_context(self):
        self.config['videoType'] = 'promotion'
        self.config['mediaPolicy']['mediaFirst'] = False
        with patch.object(tenant_brief, 'gateway_call', side_effect=[{'text': '{}'}, proposal(self.ids[-1])]) as model:
            directed, _, _ = tenant_brief.direct_tenant_config(config=self.config, assets=self.assets, visual_inventory=self.inventory)
        first_raw, _ = prompt_context(model.call_args_list[0].args[2])
        repair_raw = model.call_args_list[1].args[2]['input'][0]['text'].split('CONTEXTO_MEDIOS: ', 1)[1].split('. PROPUESTA_ANTERIOR: ', 1)[0]
        self.assertEqual(first_raw, repair_raw)
        self.assertEqual(directed['scenes'][0]['media'], 'asset:' + self.ids[-1])

    def test_compaction_preserves_video_duration_and_unknown_or_partial_status(self):
        context = {'availableAssets': [{**a, 'type': 'video', 'durationSeconds': 19.875,
                    'visual': tenant_brief._director_visual_inventory(self.inventory)[a['id']]} for a in self.assets]}
        for asset in context['availableAssets'][:2]:
            asset['visual']['status'] = 'partial'
        unknown = context['availableAssets'][2]['visual']
        unknown.update(status='unknown', summary='', subjects=[], actions=[], setting=[])
        packed = tenant_brief._model_visual_context(context)
        self.assertLessEqual(len(tenant_brief._visual_context_json(packed)), tenant_brief.MAX_VISUAL_CONTEXT_CHARS)
        for before, after in zip(context['availableAssets'], packed['availableAssets']):
            self.assertEqual(after['durationSeconds'], 19.875)
            self.assertEqual(before['visual']['status'], after['visual']['status'])


class LargeContextStudioTests(unittest.TestCase):
    """40 real files, exact approval, real worker extraction/publication and bridge."""
    @classmethod
    def setUpClass(cls):
        cls.fixtures = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.fixtures.cleanup)
        directory = Path(cls.fixtures.name)
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=144x256:r=1',
                        '-frames:v', '40', '-threads', '1', str(directory / 'frame-%02d.png')],
                       check=True, capture_output=True)
        cls.actor = Actor(str(uuid.uuid4()), str(uuid.uuid4()))
        cls.template = directory / 'private'
        studio = Studio(cls.template)
        try:
            cls.pid = studio.create_project(cls.actor, config_for([]))
            cls.ids = [studio.upload(cls.actor, cls.pid, p) for p in sorted(directory.glob('frame-*.png'))]
            if len(set(cls.ids)) != 40:
                raise AssertionError('Forty distinct image hashes required')
            studio.update_project(cls.actor, cls.pid, config_for(cls.ids))
            cls.approval = studio.approve_media_set(cls.actor, cls.pid, cls.ids)
            job = studio.enqueue_analysis(cls.actor, cls.pid, cls.approval, 'large-context',
                strategy_version=analysis_worker.STRATEGY_VERSION, extractor_version=analysis_worker.EXTRACTOR_VERSION)
            provider = FakeProvider(value=large_observation())
            if not analysis_worker.run_one(studio, 'test-large', provider, job_id=job) or provider.calls != 40:
                raise AssertionError('Worker must analyze all forty images')
            inventory = studio.visual_inventory(cls.actor, cls.pid)
            if set(inventory) != set(cls.ids) or any(v['status'] != 'complete' for v in inventory.values()):
                raise AssertionError('Complete, current inventory required')
        finally:
            studio.close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'private'
        shutil.copytree(self.template, self.root)
        self.studio = Studio(self.root)
        self.addCleanup(self.studio.close)

    def direct(self):
        output = []
        request = {'action': 'direct_project', 'tenantId': self.actor.tenant_id,
                   'userId': self.actor.user_id, 'payload': {'projectId': self.pid}}
        with patch.dict(os.environ, {'CITAYA_VIDEO_STORAGE_ROOT': str(self.root)}), \
             patch.object(sys, 'stdin', io.StringIO(json.dumps(request))), \
             patch.object(bridge, 'emit', side_effect=output.append):
            bridge.main()
        return output[0]['result']

    def test_forty_approved_current_images_direct_and_validate_for_website_and_agenda(self):
        for video_type, context in (('website_showcase', 'external'), ('promotion', 'citaya-agendas')):
            config = config_for(self.ids)
            config['videoType'] = video_type
            config['project']['productContext'] = context
            self.studio.update_project(self.actor, self.pid, config)
            with patch.object(tenant_brief, 'gateway_call', return_value=proposal(self.ids[-1])) as model:
                result = self.direct()
            model.assert_called_once()
            raw, exposed = prompt_context(model.call_args.args[2])
            self.assertLessEqual(len(raw), tenant_brief.MAX_VISUAL_CONTEXT_CHARS)
            self.assertEqual([a['id'] for a in exposed['availableAssets']], self.ids)
            self.assertEqual(result['project']['config']['scenes'][0]['media'], 'asset:' + self.ids[-1])
            self.assertTrue(all(s['mode'] == 'media' for s in result['project']['config']['scenes']))
            self.assertTrue(result['report']['valid'])
            self.assertEqual(len(self.studio.visual_inventory(self.actor, self.pid)), 40)
            for private in ('sha256', 'approval_id', str(self.root), self.actor.tenant_id):
                self.assertNotIn(private, raw)

    def assert_invalidated(self):
        config = config_for(self.ids)
        config['scenes'] = [{'mode': 'media', 'capability': 'provided_business_content',
                             'media': 'asset:' + self.ids[-1], 'duration': 15}]
        with self.assertRaises(ConfigError) as error:
            self.studio.validated(self.actor, self.pid, config, 'preview')
        self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
        with patch.object(tenant_brief, 'gateway_call') as model:
            with self.assertRaises(ConfigError) as error:
                self.direct()
            self.assertEqual(error.exception.code, 'ANALYSIS_APPROVAL_REQUIRED')
            model.assert_not_called()

    def test_revoked_approval_still_fails_closed_before_model(self):
        self.studio.revoke_media_set(self.actor, self.approval)
        self.assert_invalidated()

    def test_stale_hash_still_fails_closed_before_model(self):
        row = self.studio.row('video_assets', self.actor, self.ids[-1])
        path = self.root / row['storage_path']
        path.write_bytes(path.read_bytes() + b'changed')
        self.assert_invalidated()


if __name__ == '__main__':
    unittest.main()