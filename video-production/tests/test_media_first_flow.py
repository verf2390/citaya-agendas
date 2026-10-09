"""Offline integration: real uploads, approvals, extraction, SQLite, bridge,
materialization, production validation, renderer and audio mix. Only models and
process scheduling are substituted; no real Studio storage or services are used.
"""
import copy
import io
import json
import os
from pathlib import Path
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
import director_analysis
import tenant_brief
from studio import Actor, Studio
from production import ConfigError, validate, probe, schema_validate, tenant_schema_validate, digest
from compose import compile_composition
from audio_mix import mix_audio
from editorial_contract import media_first, selected_visual_ids
from test_analysis_worker import FakeProvider
from test_vision_provider import observation

COPY = {'hook': '¿Tu web se ve igual que todas las demás?', 'secondaryHook': 'Diseño con identidad',
        'benefit': 'Proyecto: Diego Videla Arquitectos', 'cta': 'Hablemos de tu próxima web'}
BRIEF = ('Proyecto mostrado: Diego Videla Arquitectos\n'
         'usar únicamente video de navegación y pantallazos proporcionados; la página web debe ser la protagonista\n'
         'DIRECCIÓN VISUAL: Mostrar primero la portada, luego proyectos, después contacto.\n'
         'Vista atractiva de la portada. Navegación por secciones destacadas.')


class WebsiteFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.fixtures.cleanup)
        cls.files = []
        for label, color in [('homepage', 'red'), ('projects', 'blue'), ('about', 'green'), ('contact', 'yellow')]:
            path = Path(cls.fixtures.name) / (label + '.png')
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i',f'color={color}:s=144x256',
                            '-vf',f"drawtext=text='{label}':fontsize=14:fontcolor=white:x=10:y=80",
                            '-frames:v','1','-threads','1',str(path)], check=True, capture_output=True)
            cls.files.append(path)
        video = Path(cls.fixtures.name) / 'navigation.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=144x256:r=12','-t','20',
                        '-c:v','libx264','-preset','ultrafast','-threads','1',str(video)], check=True, capture_output=True)
        cls.files.append(video)
        voice = Path(cls.fixtures.name) / 'voice.wav'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=330:sample_rate=48000',
                        '-t','10.13',str(voice)],check=True,capture_output=True)
        cls.files.append(voice)
        cls.creator_files = []
        for label, color in [('intro', 'purple'), ('outro', 'orange')]:
            path = Path(cls.fixtures.name) / (label + '.mp4')
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                            f'color={color}:s=144x256:r=12', '-t', '2', '-c:v', 'libx264',
                            '-threads', '1', str(path)], check=True, capture_output=True)
            cls.creator_files.append(path)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.s = Studio(Path(self.temp.name) / 'private')
        self.addCleanup(self.s.close)
        self.actor = Actor(str(uuid.uuid4()), str(uuid.uuid4()))
        self.config = {'product':'custom-client-video', 'template':'creator-led-v1',
                       'brand':{'businessName':'CITAYA'}, 'videoType':'website_showcase',
                       'content':dict(COPY), 'timing':{'intro':2,'demo':16,'outro':2},
                       'project':{'creativeBrief':BRIEF,'productContext':'external','targetDurationSeconds':20},
                       'mediaApproved':True}
        self.pid = self.s.create_project(self.actor,self.config)
        self.ids = [self.s.upload(self.actor,self.pid,p) for p in self.files]
        self.config['media'] = {'images':['asset:'+i for i in self.ids[:4]], 'videos':['asset:'+self.ids[4]],
                                'clientVoiceover':'asset:'+self.ids[5]}
        self.s.update_project(self.actor,self.pid,self.config)
        self.labels = dict(zip(self.ids, ['homepage','projects','about','contact','navigation','voice']))

    def call(self, action, **payload):
        request = {'action':action,'tenantId':self.actor.tenant_id,'userId':self.actor.user_id,
                   'payload':{'projectId':self.pid,**payload}}
        output=[]
        with patch.dict(os.environ, {'CITAYA_VIDEO_STORAGE_ROOT':str(self.s.root)}), \
             patch.object(sys,'stdin',io.StringIO(json.dumps(request))), patch.object(bridge,'emit',side_effect=output.append):
            bridge.main()
        return output[0]['result']

    def run_analysis(self, studio, job_id):
        job = studio.analysis_job(self.actor,job_id)
        members = studio.media_approval(self.actor,job['approval_id'])['members']
        labels = iter(self.labels[m['asset_id']] for m in members)
        class WebsiteProvider(FakeProvider):
            def analyze_asset(provider, frames):
                label = next(labels)
                value = observation()
                value.update(summary='Website '+label, setting=['website'], subjects=[label], actions=['navigation'] if label=='navigation' else ['website section'])
                value['evidence'][0]['supports'] = value['actions']
                provider.value = value
                return super().analyze_asset(frames)
        provider=WebsiteProvider()
        self.assertTrue(analysis_worker.run_one(studio,'test-ui',provider,job_id=job_id))
        self.assertEqual(provider.calls,len(members))

    def analyze(self):
        with patch.object(director_analysis,'launch_analysis',side_effect=self.run_analysis):
            result=self.call('prepare_direction',assetIds=sorted(self.ids[:5]),analysisConsent=True)
        self.assertEqual(result['status'],'analyzing')
        self.assertEqual(self.call('direction_analysis_status',analysisJobId=result['analysisJobId'])['status'],'ready')
        return result['analysisJobId']

    def proposal(self, _endpoint, _token, payload):
        prompt=payload['input'][0]['text']
        self.assertEqual(payload['tools'],[])
        self.assertNotIn(str(self.s.root),prompt)
        self.assertNotIn(self.ids[5],prompt)
        context=json.loads(prompt.split('CONTEXTO_MEDIOS: ',1)[1].split('. BRIEF: ',1)[0])
        lookup={a['visual']['subjects'][0]:a['id'] for a in context['availableAssets'] if 'visual' in a}
        scenes=[{'headline':'Vista atractiva de la portada', 'visualIntent':'media','assetId':lookup[label],
                 'durationSeconds':3} for label in ['homepage','projects','about','contact','navigation']]
        return {'text':json.dumps({**COPY,'scenes':scenes,'outroSeconds':1.5}),'toolCalls':[]}

    def add_legacy_clips(self, slots=('introVideo', 'outroVideo')):
        ids = [self.s.upload(self.actor, self.pid, path) for path in self.creator_files]
        self.labels.update(zip(ids, ('intro', 'outro')))
        self.config['creator'] = {slot: 'asset:' + aid for slot, aid in
                                  zip(('introVideo', 'outroVideo'), ids) if slot in slots}
        self.s.update_project(self.actor, self.pid, self.config)
        return ids

    def analyze_selected(self):
        ids = selected_visual_ids(self.config)
        with patch.object(director_analysis, 'launch_analysis', side_effect=self.run_analysis):
            result = self.call('prepare_direction', assetIds=ids, analysisConsent=True)
        self.assertEqual(self.call('direction_analysis_status', analysisJobId=result['analysisJobId'])['status'], 'ready')
        return result['analysisJobId']

    def test_legacy_intro_and_outro_require_analysis_in_studio_and_director(self):
        self.analyze()
        for slot in ('introVideo', 'outroVideo'):
            with self.subTest(slot=slot):
                self.add_legacy_clips((slot,))
                # A renderable main scene cannot hide an unanalysed bookend.
                config = {**self.config, 'scenes': [{'mode': 'media', 'media': 'asset:' + self.ids[0],
                            'capability': 'provided_business_content', 'duration': 16}]}
                with self.assertRaises(ConfigError) as error:
                    self.s.validated(self.actor, self.pid, config, 'preview')
                self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
                with patch.object(tenant_brief, 'gateway_call') as model:
                    with self.assertRaises(ConfigError) as error:
                        self.call('direct_project')
                    self.assertEqual(error.exception.code, 'ANALYSIS_APPROVAL_REQUIRED')
                    model.assert_not_called()
                with patch.object(director_analysis, 'launch_analysis') as launch:
                    with self.assertRaises(ConfigError) as error:
                        self.call('prepare_direction', assetIds=sorted(self.ids[:5]), analysisConsent=True)
                    self.assertEqual(error.exception.code, 'ANALYSIS_APPROVAL_REQUIRED')
                    launch.assert_not_called()
                # Also exercise the Director's own guard, independently of bridge.
                assets = [{'id': aid, 'assetType': self.s.row('video_assets', self.actor, aid)['asset_type'],
                           'durationMs': self.s.row('video_assets', self.actor, aid)['duration_ms']}
                          for aid in selected_visual_ids(config)]
                with patch.object(tenant_brief, 'gateway_call') as model:
                    with self.assertRaises(tenant_brief.TenantBriefError) as error:
                        tenant_brief.direct_tenant_config(config=config, assets=assets,
                            visual_inventory=self.s.visual_inventory(self.actor, self.pid))
                    self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
                    model.assert_not_called()

    def test_legacy_clips_analyzed_directed_materialized_and_rendered(self):
        intro, outro = self.add_legacy_clips()
        job = self.analyze_selected()
        members = self.s.media_approval(self.actor, self.s.analysis_job(self.actor, job)['approval_id'])['members']
        self.assertEqual(sorted(m['asset_id'] for m in members), sorted(self.ids[:5] + [intro, outro]))
        with patch.object(tenant_brief, 'gateway_call', side_effect=self.proposal):
            c = self.call('direct_project')['project']['config']
        self.assertEqual(c['media']['creatorIntro'], 'asset:' + intro)
        self.assertEqual(c['media']['creatorOutro'], 'asset:' + outro)
        self.assertTrue(self.s.validated(self.actor, self.pid, c, 'preview')[1]['valid'])
        with self.s.materialize(self.actor, self.pid, c) as local, tempfile.TemporaryDirectory() as d:
            normalized, _, ctx = validate(local)
            comp, _ = compile_composition(normalized, ctx, Path(d), 'preview')
            html = (comp / 'index.html').read_text()
            self.assertIn('id="creator-intro-video"', html)
            self.assertIn('id="outro-video"', html)
            for aid in (intro, outro):
                sha = self.s.row('video_assets', self.actor, aid)['sha256']
                rendered_path = 'assets/inputs/' + sha[:16] + '.mp4'
                self.assertIn(rendered_path, html)
                self.assertEqual(digest(comp / rendered_path), sha)

    def test_matching_legacy_and_public_slots_deduplicate_and_validate(self):
        intro, outro = self.add_legacy_clips()
        self.config['media'].update(creatorIntro='asset:' + intro, creatorOutro='asset:' + outro)
        self.s.update_project(self.actor, self.pid, self.config)
        self.assertEqual(selected_visual_ids(self.config), sorted(self.ids[:5] + [intro, outro]))
        job = self.analyze_selected()
        members = self.s.media_approval(self.actor, self.s.analysis_job(self.actor, job)['approval_id'])['members']
        self.assertEqual(len(members), 7)
        with patch.object(tenant_brief, 'gateway_call', side_effect=self.proposal):
            c = self.call('direct_project')['project']['config']
        c['creator'].update(self.config['creator'])
        self.assertTrue(self.s.validated(self.actor, self.pid, c, 'preview')[1]['valid'])

    def test_legacy_clip_revocation_and_stale_hash_fail_closed(self):
        self.analyze()
        intro, _ = self.add_legacy_clips()
        job = self.analyze_selected()
        with patch.object(tenant_brief, 'gateway_call', side_effect=self.proposal):
            c = self.call('direct_project')['project']['config']
        # Exercise the legacy-only API config, not just its normalized output.
        c['creator'].update(self.config['creator'])
        c['media'].pop('creatorIntro'); c['media'].pop('creatorOutro')
        self.assertTrue(self.s.validated(self.actor, self.pid, c, 'preview')[1]['valid'])
        source = self.s.root / self.s.row('video_assets', self.actor, intro)['storage_path']
        original = source.read_bytes()
        for invalidation in ('stale_hash', 'revoked'):
            with self.subTest(invalidation=invalidation):
                if invalidation == 'stale_hash':
                    source.write_bytes(original + b'changed')
                else:
                    source.write_bytes(original)
                    self.s.revoke_media_set(self.actor, self.s.analysis_job(self.actor, job)['approval_id'])
                with self.assertRaises(ConfigError) as error:
                    self.s.validated(self.actor, self.pid, c, 'preview')
                self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')

    def test_detected_restriction_without_website_type_requires_real_assets(self):
        self.config['videoType'] = 'promotion'
        brief = 'Usa únicamente los videos e imágenes que te proporcioné.'
        self.config['project']['creativeBrief'] = brief
        self.s.update_project(self.actor, self.pid, self.config)
        with patch.object(tenant_brief, 'gateway_call') as model:
            with self.assertRaises(ConfigError) as error:
                self.call('direct_project')
            self.assertEqual(error.exception.code, 'ANALYSIS_APPROVAL_REQUIRED')
            model.assert_not_called()
        self.analyze()
        with patch.object(tenant_brief, 'gateway_call', side_effect=self.proposal):
            c = self.call('direct_project')['project']['config']
        self.assertTrue(c['mediaPolicy']['mediaFirst'])
        self.assertTrue(all(s['mode'] == 'media' and (s.get('media') or s.get('video'))
                            in {'asset:' + aid for aid in self.ids[:5]} for s in c['scenes']))
        self.assertTrue(self.s.validated(self.actor, self.pid, c, 'preview')[1]['valid'])

    def test_non_media_first_legacy_creator_render_needs_no_visual_approval(self):
        intro, outro = self.add_legacy_clips()
        c = copy.deepcopy(self.config)
        c['videoType'] = 'promotion'
        c['project']['creativeBrief'] = 'Presenta nuestros servicios.'
        c['scenes'] = [{'mode': 'media', 'media': 'asset:' + self.ids[0],
                        'capability': 'provided_business_content', 'duration': 16}]
        self.assertEqual(self.s.visual_inventory(self.actor, self.pid), {})
        self.assertTrue(self.s.validated(self.actor, self.pid, c, 'preview')[1]['valid'])
        with self.s.materialize(self.actor, self.pid, c) as local, tempfile.TemporaryDirectory() as d:
            normalized, _, ctx = validate(local)
            comp, _ = compile_composition(normalized, ctx, Path(d), 'preview')
            html = (comp / 'index.html').read_text()
            for aid in (intro, outro):
                sha = self.s.row('video_assets', self.actor, aid)['sha256']
                rendered_path = 'assets/inputs/' + sha[:16] + '.mp4'
                self.assertIn(rendered_path, html)
                self.assertEqual(digest(comp / rendered_path), sha)

    def test_legacy_creator_assets_remain_project_and_tenant_scoped(self):
        for actor in (self.actor, Actor(str(uuid.uuid4()), str(uuid.uuid4()))):
            with self.subTest(tenant=actor == self.actor):
                other = self.s.create_project(actor, self.config)
                aid = self.s.upload(actor, other, self.creator_files[0])
                config = {**self.config, 'creator': {'introVideo': 'asset:' + aid}}
                self.s.update_project(self.actor, self.pid, config)
                with patch.object(director_analysis, 'launch_analysis') as launch:
                    with self.assertRaises(ConfigError):
                        self.call('prepare_direction', assetIds=selected_visual_ids(config), analysisConsent=True)
                    launch.assert_not_called()

    def test_diego_videla_upload_analysis_director_materialization_renderer_audio(self):
        job_id=self.analyze()
        self.assertEqual(len(self.s.visual_inventory(self.actor,self.pid)),5)
        self.assertNotIn(self.ids[5],self.s.visual_inventory(self.actor,self.pid))
        with patch.object(tenant_brief,'gateway_call',side_effect=self.proposal):
            result=self.call('direct_project',brief=BRIEF)
        c=result['project']['config']
        self.assertEqual(c['template'],'local-business-promo-v2')
        self.assertEqual([s.get('media') or s.get('video') for s in c['scenes']],['asset:'+i for i in self.ids[:5]])
        self.assertTrue(all(s['mode']=='media' and s['headline'] in COPY.values() for s in c['scenes']))
        self.assertEqual(c['media']['clientVoiceover'],'asset:'+self.ids[5])
        self.assertEqual(c['creator']['voiceoverStart'],0)
        self.assertAlmostEqual(sum(c['timing'].values()),10.63,places=5)
        self.assertLess(max(s['duration'] for s in c['scenes'])-min(s['duration'] for s in c['scenes']),.01)
        schema_validate(c);tenant_schema_validate(c)
        self.assertTrue(self.s.validated(self.actor,self.pid,c,'preview')[1]['valid'])
        with self.s.materialize(self.actor,self.pid,c) as local, tempfile.TemporaryDirectory() as d:
            normalized,report,ctx=validate(local)
            self.assertEqual(ctx['speech'][0]['duration'],10.13)
            comp,_=compile_composition(normalized,ctx,Path(d),'preview')
            html=(comp/'index.html').read_text()
            for forbidden in ['Negocio Demo','Vista atractiva','Navegación por secciones','Interfaz Citaya','citaya-admin-demo','assets/ui/']:
                self.assertNotIn(forbidden,html)
            self.assertIn('data-media-start="0.000000"',html)
            mix_audio(normalized,ctx,Path(d),comp)
            self.assertAlmostEqual(float(probe(comp/'assets/master.wav')['format']['duration']),10.63,places=2)
            self.assertLess(report['duration']-ctx['speech'][0]['duration'],.6)
        # Preview and final approval contract still applies to this actual config.
        with self.assertRaises(ConfigError) as caught:
            self.s.enqueue(self.actor,self.pid,'final','no-preview')
        self.assertEqual(caught.exception.code,'FINAL_APPROVAL_REQUIRED')
        self.s.revoke_media_set(self.actor,self.s.analysis_job(self.actor,job_id)['approval_id'])
        with self.assertRaises(ConfigError) as caught:
            self.s.validated(self.actor,self.pid,c,'preview')
        self.assertEqual(caught.exception.code,'VISUAL_ANALYSIS_REQUIRED')

    def test_media_rights_are_not_analysis_consent_and_exact_set_required(self):
        for consent, ids in [(False,self.ids[:5]),(True,self.ids),(True,self.ids[:4])]:
            with self.subTest(consent=consent,ids=ids), patch.object(director_analysis,'launch_analysis') as launch:
                with self.assertRaises(ConfigError) as caught:
                    self.call('prepare_direction',assetIds=ids,analysisConsent=consent)
                self.assertEqual(caught.exception.code,'ANALYSIS_APPROVAL_REQUIRED')
                launch.assert_not_called()
        self.assertEqual(self.s.db.execute('SELECT count(*) FROM video_analysis_jobs').fetchone()[0],0)

    def test_missing_analysis_never_calls_text_model(self):
        with patch.object(tenant_brief,'gateway_call') as model:
            with self.assertRaises(ConfigError):self.call('direct_project',brief=BRIEF)
            model.assert_not_called()
        with patch.object(tenant_brief,'gateway_call') as model:
            with self.assertRaises(tenant_brief.TenantBriefError) as caught:
                tenant_brief.direct_tenant_config(config=self.config,assets=[],visual_inventory={})
            self.assertEqual(caught.exception.code,'VISUAL_ANALYSIS_REQUIRED');model.assert_not_called()

    def test_worker_failure_is_safe_and_never_directs(self):
        def fail(studio,job_id):
            provider=FakeProvider(callback=lambda: (_ for _ in ()).throw(RuntimeError('private source and narration')))
            analysis_worker.run_one(studio,'test',provider,job_id=job_id)
        with patch.object(director_analysis,'launch_analysis',side_effect=fail):
            job=self.call('prepare_direction',assetIds=sorted(self.ids[:5]),analysisConsent=True)['analysisJobId']
        with self.assertRaises(ConfigError) as caught:self.call('direction_analysis_status',analysisJobId=job)
        self.assertEqual(caught.exception.code,'VISUAL_ANALYSIS_FAILED')
        self.assertNotIn('private',str(caught.exception))
        self.assertEqual(self.s.visual_inventory(self.actor,self.pid),{})

    def test_worker_wake_claims_only_requested_job(self):
        first = self.s.approve_media_set(self.actor, self.pid, [self.ids[0]])
        second = self.s.approve_media_set(self.actor, self.pid, [self.ids[1]])
        options = dict(strategy_version=analysis_worker.STRATEGY_VERSION,
                       extractor_version=analysis_worker.EXTRACTOR_VERSION)
        first_job = self.s.enqueue_analysis(self.actor,self.pid,first,'first',**options)
        second_job = self.s.enqueue_analysis(self.actor,self.pid,second,'second',**options)
        analysis_worker.run_one(self.s,'specific',FakeProvider(),job_id=second_job)
        self.assertEqual(self.s.analysis_job(self.actor,first_job)['status'],'queued')
        self.assertEqual(self.s.analysis_job(self.actor,second_job)['status'],'completed')

    def test_repeated_prepare_reuses_active_job_without_expanding_approval(self):
        with patch.object(director_analysis,'launch_analysis'):
            one=self.call('prepare_direction',assetIds=sorted(self.ids[:5]),analysisConsent=True)
            two=self.call('prepare_direction',assetIds=sorted(self.ids[:5]),analysisConsent=True)
        self.assertEqual(one['analysisJobId'],two['analysisJobId'])
        job=self.s.analysis_job(self.actor,one['analysisJobId'])
        members=self.s.media_approval(self.actor,job['approval_id'])['members']
        self.assertEqual(sorted(m['asset_id'] for m in members),sorted(self.ids[:5]))
        self.assertEqual(self.s.db.execute('SELECT count(*) FROM video_analysis_jobs').fetchone()[0],1)

    def test_structured_policy_in_agenda_project_uses_real_analyzed_media(self):
        self.config['videoType'] = 'promotion'
        self.config['mediaPolicy'] = {'mediaFirst': True}
        self.config['project'].update(creativeBrief='Presenta el proyecto.', productContext='citaya-agendas')
        self.s.update_project(self.actor, self.pid, self.config)
        self.analyze()
        with patch.object(tenant_brief, 'gateway_call', side_effect=self.proposal):
            directed = self.call('direct_project')['project']['config']
        self.assertTrue(directed['mediaPolicy']['mediaFirst'])
        self.assertTrue(all(s['mode'] == 'media' for s in directed['scenes']))
        self.assertTrue(self.s.validated(self.actor, self.pid, directed, 'preview')[1]['valid'])
        with self.s.materialize(self.actor, self.pid, directed) as local, tempfile.TemporaryDirectory() as d:
            normalized, _, ctx = validate(local)
            comp, _ = compile_composition(normalized, ctx, Path(d), 'preview')
            self.assertFalse((comp / 'assets/ui').exists())
            source = (comp / 'index.html').read_text()
            for aid in self.ids[:5]:
                sha = self.s.row('video_assets', self.actor, aid)['sha256']
                self.assertIn(sha[:16], source)

    def test_foreign_tenant_cannot_poll_analysis(self):
        with patch.object(director_analysis,'launch_analysis'):
            job=self.call('prepare_direction',assetIds=sorted(self.ids[:5]),analysisConsent=True)['analysisJobId']
        stranger=Actor(str(uuid.uuid4()),str(uuid.uuid4()))
        with self.assertRaises(ConfigError):director_analysis.direction_analysis_status(self.s,stranger,self.pid,job)

    def test_project_change_during_model_call_is_fenced(self):
        self.analyze()
        def change(*args):
            response=self.proposal(*args)
            self.s.update_project(self.actor,self.pid,self.config)
            return response
        with patch.object(tenant_brief,'gateway_call',side_effect=change):
            with self.assertRaises(ConfigError) as caught:self.call('direct_project',brief=BRIEF)
        self.assertEqual(caught.exception.code,'DIRECTOR_VISUAL_STALE')


class StructuredPolicyFlowTests(unittest.TestCase):
    """Canonical policy round-trip through the real bridge and temporary Studio."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.actor = Actor(str(uuid.uuid4()), str(uuid.uuid4()))

    def call(self, action, **payload):
        request = {'action': action, 'tenantId': self.actor.tenant_id,
                   'userId': self.actor.user_id, 'payload': payload}
        output = []
        with patch.dict(os.environ, {'CITAYA_VIDEO_STORAGE_ROOT': self.temp.name}), \
             patch.object(sys, 'stdin', io.StringIO(json.dumps(request))), \
             patch.object(bridge, 'emit', side_effect=output.append):
            bridge.main()
        return output[0]['result']

    def create(self, **options):
        with patch.object(tenant_brief, 'gateway_call', return_value={'text': json.dumps(COPY)}):
            return self.call('create_from_brief', title='Policy draft', businessName='CITAYA',
                brief='Presenta el proyecto.', niche='local-business', style='minimal',
                durationSeconds=15, **options)

    def test_update_preserves_omitted_flag_and_accepts_explicit_booleans(self):
        base = {'product': 'custom-client-video', 'brand': {'businessName': 'CITAYA'},
                'content': dict(COPY), 'project': {'creativeBrief': 'Presenta el proyecto.'}}
        for previous in (True, False, None):
            for payload_policy in (None, {}, {'allowStockMedia': False},
                                   {'mediaFirst': True}, {'mediaFirst': False}):
                with self.subTest(previous=previous, payload_policy=payload_policy):
                    original = copy.deepcopy(base)
                    if previous is not None:
                        original['mediaPolicy'] = {'mediaFirst': previous, 'allowGeneratedMedia': False}
                    project = self.call('create_project', config=original)
                    update = copy.deepcopy(base)
                    # Other fields retain replacement semantics, not a deep merge.
                    update['content'] = {'hook': 'Nuevo hook'}
                    if payload_policy is not None:
                        update['mediaPolicy'] = copy.deepcopy(payload_policy)
                    untouched = copy.deepcopy(update)
                    saved = self.call('update_project', projectId=project['id'], config=update)['config']
                    expected = (payload_policy or {}).get('mediaFirst', previous)
                    if expected is None:
                        self.assertNotIn('mediaFirst', saved.get('mediaPolicy', {}))
                    else:
                        self.assertIs(saved['mediaPolicy']['mediaFirst'], expected)
                    self.assertEqual(saved['content'], {'hook': 'Nuevo hook'})
                    self.assertNotIn('allowGeneratedMedia', saved.get('mediaPolicy', {}))
                    if payload_policy and 'allowStockMedia' in payload_policy:
                        self.assertFalse(saved['mediaPolicy']['allowStockMedia'])
                    self.assertEqual(update, untouched)
        # A new legacy config does not inherit policy from another project.
        new_project = self.call('create_project', config=base)
        self.assertNotIn('mediaPolicy', new_project['config'])
        self.assertFalse(media_first(new_project['config']))

    def test_update_without_policy_cannot_disable_agenda_or_external_fail_closed(self):
        for context in ('citaya-agendas', 'external'):
            for empty_container in (False, True):
                with self.subTest(context=context, empty_container=empty_container):
                    project = self.create(productContext=context, mediaPolicy={'mediaFirst': True})['project']
                    pid = project['id']
                    with patch.object(tenant_brief, 'gateway_call') as model:
                        with self.assertRaises(tenant_brief.TenantBriefError) as error:
                            self.call('direct_project', projectId=pid)
                        self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
                        model.assert_not_called()
                    update = copy.deepcopy(project['config'])
                    update.pop('mediaPolicy')
                    if empty_container:
                        update['mediaPolicy'] = {}
                    update['content']['hook'] = 'Otro hook'
                    saved = self.call('update_project', projectId=pid, config=update)
                    self.assertTrue(saved['config']['mediaPolicy']['mediaFirst'])
                    reloaded = self.call('project_detail', projectId=pid)
                    self.assertTrue(reloaded['config']['mediaPolicy']['mediaFirst'])
                    with patch.object(tenant_brief, 'gateway_call') as model:
                        with self.assertRaises(tenant_brief.TenantBriefError) as error:
                            self.call('direct_project', projectId=pid)
                        self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
                        model.assert_not_called()

    def test_explicit_false_disables_normal_policy_but_not_website_requirement(self):
        for video_type in ('promotion', 'website_showcase'):
            with self.subTest(video_type=video_type):
                project = self.create(videoType=video_type, productContext='citaya-agendas',
                                      mediaPolicy={'mediaFirst': True})['project']
                config = copy.deepcopy(project['config'])
                config['mediaPolicy']['mediaFirst'] = False
                saved = self.call('update_project', projectId=project['id'], config=config)
                self.assertIs(saved['config']['mediaPolicy']['mediaFirst'], False)
                self.assertEqual(media_first(saved['config']), video_type == 'website_showcase')
                if video_type == 'website_showcase':
                    with patch.object(tenant_brief, 'gateway_call') as model:
                        with self.assertRaises(tenant_brief.TenantBriefError) as error:
                            self.call('direct_project', projectId=project['id'])
                        self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
                        model.assert_not_called()
                else:
                    proposal = {**COPY, 'outroSeconds': 2, 'scenes': [
                        {'headline': COPY['secondaryHook'], 'visualIntent': 'agenda', 'durationSeconds': 3}]}
                    with patch.object(tenant_brief, 'gateway_call', return_value={'text': json.dumps(proposal)}):
                        directed = self.call('direct_project', projectId=project['id'])
                    self.assertEqual(directed['project']['config']['scenes'][0]['mode'], 'calendar')
                    self.assertTrue(directed['report']['valid'])

    def test_update_rejects_invalid_policy_without_altering_saved_decision(self):
        project = self.create(mediaPolicy={'mediaFirst': True})['project']
        pid = project['id']
        policies = [None, [], 'true', 0, {'unexpected': True}]
        policies += [{'mediaFirst': value} for value in ('true', 'false', 0, 1, None, [], {})]
        for policy in policies:
            with self.subTest(policy=policy):
                config = copy.deepcopy(project['config'])
                config['mediaPolicy'] = policy
                with self.assertRaises(ConfigError) as error:
                    self.call('update_project', projectId=pid, config=config)
                self.assertEqual(error.exception.code, 'SCHEMA_VALIDATION')
                reloaded = self.call('project_detail', projectId=pid)
                self.assertEqual(reloaded['config'], project['config'])
                self.assertEqual(reloaded['revision'], project['revision'])

    def test_explicit_checkbox_create_reload_edit_and_direct_fail_closed(self):
        for context in ('external', 'citaya-agendas'):
            with self.subTest(context=context):
                created = self.create(productContext=context, mediaPolicy={'mediaFirst': True})
                self.assertEqual(created['report']['code'], 'VISUAL_ANALYSIS_REQUIRED')
                project = created['project']
                pid = project['id']
                self.assertTrue(project['config']['mediaPolicy']['mediaFirst'])
                reloaded = self.call('project_detail', projectId=pid)
                self.assertTrue(reloaded['config']['mediaPolicy']['mediaFirst'])
                config = reloaded['config']
                config['content']['hook'] = 'Nuevo hook'
                edited = self.call('update_project', projectId=pid, config=config)
                self.assertTrue(edited['config']['mediaPolicy']['mediaFirst'])
                with patch.object(tenant_brief, 'gateway_call') as model:
                    with self.assertRaises(tenant_brief.TenantBriefError) as error:
                        self.call('direct_project', projectId=pid)
                    self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
                    model.assert_not_called()

    def test_website_creation_is_mandatory_even_when_flag_absent_or_false(self):
        for policy in ({}, {'mediaFirst': False}):
            created = self.create(videoType='website_showcase', mediaPolicy=policy)
            self.assertTrue(created['project']['config']['mediaPolicy']['mediaFirst'])
            self.assertEqual(created['report']['code'], 'VISUAL_ANALYSIS_REQUIRED')

    def test_normal_legacy_create_and_reload_without_policy_remain_compatible(self):
        created = self.create()
        config = created['project']['config']
        self.assertFalse(media_first(config))
        self.assertTrue(created['report']['valid'])
        reloaded = self.call('project_detail', projectId=created['project']['id'])
        self.assertFalse(media_first(reloaded['config']))

    def test_creation_rejects_non_boolean_policy_before_model(self):
        for policy in ({'mediaFirst': 'true'}, {'mediaFirst': 1}, []):
            with self.subTest(policy=policy), patch.object(tenant_brief, 'gateway_call') as model:
                with self.assertRaises((ConfigError, tenant_brief.TenantBriefError)) as error:
                    self.call('create_from_brief', mediaPolicy=policy)
                self.assertEqual(error.exception.code, 'INVALID_MEDIA_POLICY')
                model.assert_not_called()


class EditorialContractTests(unittest.TestCase):
    def test_explicit_agenda_without_media_first_still_allows_product_ui(self):
        config = {'product': 'custom-client-video', 'brand': {'businessName': 'CITAYA'},
                  'content': COPY, 'project': {'creativeBrief': 'Presenta el producto.',
                                             'productContext': 'citaya-agendas'}}
        proposal = {**COPY, 'outroSeconds': 2, 'scenes': [
            {'headline': 'Diseño con identidad', 'visualIntent': 'agenda', 'durationSeconds': 3}]}
        with patch.object(tenant_brief, 'gateway_call', return_value={'text': json.dumps(proposal)}):
            directed, _, _ = tenant_brief.direct_tenant_config(config=config, assets=[])
        self.assertFalse(media_first(directed))
        self.assertEqual(directed['scenes'][0]['mode'], 'calendar')
        self.assertTrue(validate(directed)[1]['valid'])

    def test_structured_policy_is_independent_of_textual_detection(self):
        texts = ['Presenta el proyecto.', 'Usa solamente el material que te mandé.',
                 'No tienes que usar únicamente los archivos adjuntos.',
                 'Trata de usar solamente las imágenes entregadas.',
                 'No uses solo los archivos adjuntos.']
        for brief in texts:
            with self.subTest(brief=brief):
                self.assertTrue(media_first({'mediaPolicy': {'mediaFirst': True}}, brief))
                for policy in ({}, {'mediaFirst': False}):
                    self.assertTrue(media_first({'videoType': 'website_showcase', 'mediaPolicy': policy}, brief))
        self.assertFalse(media_first({'project': {'creativeBrief': texts[0]}}))

    def test_structured_policy_blocks_missing_inventory_for_agenda_and_external(self):
        for context in ('external', 'citaya-agendas'):
            config = {'product': 'custom-client-video', 'brand': {'businessName': 'CITAYA'},
                      'mediaPolicy': {'mediaFirst': True}, 'content': COPY,
                      'project': {'creativeBrief': 'Usa solamente el material que te mandé.',
                                  'productContext': context}}
            with self.subTest(context=context), patch.object(tenant_brief, 'gateway_call') as model:
                with self.assertRaises(tenant_brief.TenantBriefError) as error:
                    tenant_brief.direct_tenant_config(config=config, assets=[], visual_inventory={})
                self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
                model.assert_not_called()

    def test_structured_policy_with_inventory_only_accepts_authorized_visual_scenes(self):
        asset_id = str(uuid.uuid4())
        config = {'product': 'custom-client-video', 'brand': {'businessName': 'CITAYA'},
                  'mediaPolicy': {'mediaFirst': True}, 'content': COPY,
                  'project': {'creativeBrief': 'Presenta el proyecto.', 'productContext': 'citaya-agendas'},
                  'media': {'images': ['asset:' + asset_id]}}
        assets = [{'id': asset_id, 'assetType': 'image'}]
        visual = observation(); visual.pop('evidence'); visual['status'] = 'complete'
        inventory = {asset_id: visual}
        for scene in ({'visualIntent': 'generic'}, {'visualIntent': 'agenda'},
                      {'visualIntent': 'media'}, {'visualIntent': 'media', 'assetId': 'unauthorized'},
                      {'visualIntent': 'media', 'assetId': asset_id}):
            valid = scene.get('assetId') == asset_id
            proposal = {**COPY, 'outroSeconds': 2, 'scenes': [
                {'headline': COPY['secondaryHook'], 'durationSeconds': 3, **scene}]}
            with self.subTest(scene=scene), patch.object(tenant_brief, 'gateway_call',
                    return_value={'text': json.dumps(proposal)}) as model:
                if valid:
                    directed, _, _ = tenant_brief.direct_tenant_config(config=config,
                        assets=assets, visual_inventory=inventory)
                    self.assertTrue(directed['mediaPolicy']['mediaFirst'])
                    self.assertEqual(directed['template'], 'local-business-promo-v2')
                    self.assertTrue(all(s['mode'] == 'media' and s.get('media') == 'asset:' + asset_id
                                        for s in directed['scenes']))
                else:
                    with self.assertRaises(tenant_brief.TenantBriefError):
                        tenant_brief.direct_tenant_config(config=config, assets=assets,
                            visual_inventory=inventory)
                self.assertEqual(model.call_count, 1)

    def test_explicit_spanish_restrictions_and_vague_requests(self):
        restricted = [
            'No inventes ninguna pantalla. Usa solo los archivos adjuntos.',
            'Usa únicamente los videos e imágenes que te proporcioné.',
            'Utiliza exclusivamente el material suministrado.',
            'Trabaja solo con el material que te envié.',
            'Usa solamente los videos proporcionados.',
            'Usa únicamente las imágenes entregadas.',
            'No inventes ninguna pantalla; usa los medios suministrados.',
            'No inventes contenido; usa los archivos adjuntos.',
            'No agregues contenido que no esté en los archivos proporcionados.',
            'Utilizar exclusivamente el archivo enviado.',
            'Trabajar solamente con la imagen adjunta.',
            'USA ÚNICAMENTE\nLOS MEDIOS ENTREGADOS.',
            'Usa únicamente estos videos proporcionados.',
            'Usa solo mis imágenes proporcionadas.',
            'Usa solamente los medios entregados.',
            'Usa solo mis imágenes.',
        ]
        vague = [
            'Usa imágenes para mostrar el proyecto.', 'Puedes usar los videos proporcionados.',
            'Inspírate en los archivos adjuntos.', 'Muestra el material.',
            'Usa imágenes.', 'Puedes usar los videos.',
            'Solo quiero un anuncio. Inspírate en los archivos adjuntos.',
            'No uses solo los archivos adjuntos.',
            'No uses únicamente las imágenes entregadas.',
            'No utilices exclusivamente ese material.',
            'No use exclusivamente el material adjunto.',
            'No usar solo los archivos adjuntos.',
            'No te limites a usar solo los archivos adjuntos.',
            'Puedes usar solo los videos proporcionados.',
        ]
        for brief in restricted + vague:
            with self.subTest(brief=brief):
                self.assertEqual(media_first({'project': {'creativeBrief': brief}}), brief in restricted)

    def test_structured_policy_and_website_keep_their_existing_precedence(self):
        self.assertTrue(media_first({'mediaPolicy': {'mediaFirst': True}}, 'Usa imágenes.'))
        self.assertTrue(media_first({'videoType': 'website_showcase'}, 'Usa imágenes.'))
        self.assertFalse(media_first({'mediaPolicy': {'mediaFirst': False}}, 'Usa imágenes.'))
        # False is not an opt-out from an explicit restriction or website mode.
        self.assertTrue(media_first({'mediaPolicy': {'mediaFirst': False}}, 'Usa solo los archivos adjuntos.'))
        self.assertTrue(media_first({'mediaPolicy': {'mediaFirst': False}, 'videoType': 'website_showcase'}))

    def test_detected_restriction_cannot_fallback_or_select_unapproved_assets(self):
        config = {'product': 'custom-client-video', 'brand': {'businessName': 'Agency'},
                  'project': {'creativeBrief': 'Trabaja solo con el material que te envié.'}}
        with patch.object(tenant_brief, 'gateway_call') as model:
            with self.assertRaises(tenant_brief.TenantBriefError) as error:
                tenant_brief.direct_tenant_config(config=config, assets=[], visual_inventory={})
            self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
            model.assert_not_called()
        visual = observation(); visual.pop('evidence'); visual['status'] = 'complete'
        for scene in ({'visualIntent': 'generic'}, {'visualIntent': 'media'},
                      {'visualIntent': 'media', 'assetId': 'unapproved'}):
            proposal = {**COPY, 'outroSeconds': 2, 'scenes': [
                {'headline': 'Diseño con identidad', 'durationSeconds': 3, **scene}]}
            with self.subTest(scene=scene), patch.object(tenant_brief, 'gateway_call',
                    return_value={'text': json.dumps(proposal)}) as model:
                with self.assertRaises(tenant_brief.TenantBriefError):
                    tenant_brief.direct_tenant_config(config=config,
                        assets=[{'id': 'approved', 'assetType': 'image'}],
                        visual_inventory={'approved': visual})
                self.assertEqual(model.call_count, 1)

    def test_new_restriction_blocks_agenda_ui_and_requires_approved_media(self):
        brief = 'Usa únicamente estos videos proporcionados.'
        asset_id = str(uuid.uuid4())
        config = {'product': 'custom-client-video', 'template': 'creator-led-v1',
                  'brand': {'businessName': 'CITAYA'}, 'content': COPY,
                  'project': {'creativeBrief': brief, 'productContext': 'citaya-agendas'},
                  'media': {'videos': ['asset:' + asset_id]}}
        assets = [{'id': asset_id, 'assetType': 'video', 'durationMs': 20000}]
        with patch.object(tenant_brief, 'gateway_call') as model:
            with self.assertRaises(tenant_brief.TenantBriefError) as error:
                tenant_brief.direct_tenant_config(config=config, assets=assets, visual_inventory={})
            self.assertEqual(error.exception.code, 'VISUAL_ANALYSIS_REQUIRED')
            model.assert_not_called()

        visual = observation(); visual.pop('evidence'); visual['status'] = 'complete'
        for intent in ('generic', 'agenda'):
            proposal = {**COPY, 'outroSeconds': 2, 'scenes': [
                {'headline': 'Diseño con identidad', 'visualIntent': intent, 'durationSeconds': 3}]}
            with self.subTest(intent=intent), patch.object(tenant_brief, 'gateway_call',
                    return_value={'text': json.dumps(proposal)}) as model:
                with self.assertRaises(tenant_brief.TenantBriefError):
                    tenant_brief.direct_tenant_config(config=config, assets=assets,
                        visual_inventory={asset_id: visual})
                self.assertEqual(model.call_count, 1)

        proposal = {**COPY, 'outroSeconds': 2, 'scenes': [
            {'headline': 'Diseño con identidad', 'visualIntent': 'media',
             'assetId': asset_id, 'durationSeconds': 3}]}
        with patch.object(tenant_brief, 'gateway_call', return_value={'text': json.dumps(proposal)}):
            directed, _, _ = tenant_brief.direct_tenant_config(config=config, assets=assets,
                visual_inventory={asset_id: visual})
        self.assertTrue(directed['mediaPolicy']['mediaFirst'])
        self.assertEqual(directed['template'], 'local-business-promo-v2')
        self.assertTrue(all(s['mode'] == 'media' and
                            (s.get('media') or s.get('video')) == 'asset:' + asset_id
                            for s in directed['scenes']))

    def test_non_media_first_legacy_creator_clips_are_preserved(self):
        ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        config = {'product': 'custom-client-video', 'template': 'creator-led-v1',
                  'brand': {'businessName': 'Agency'}, 'content': COPY,
                  'project': {'creativeBrief': 'Presenta nuestros servicios.'},
                  'creator': dict(zip(('introVideo', 'outroVideo'), ['asset:' + i for i in ids]))}
        proposal = {**COPY, 'outroSeconds': 2, 'scenes': [
            {'headline': 'Diseño con identidad', 'visualIntent': 'generic', 'durationSeconds': 3}]}
        with patch.object(tenant_brief, 'gateway_call', return_value={'text': json.dumps(proposal)}):
            directed, _, _ = tenant_brief.direct_tenant_config(config=config,
                assets=[{'id': i, 'assetType': 'video', 'durationMs': 2000} for i in ids])
        self.assertFalse(media_first(directed))
        self.assertEqual(directed['media']['creatorIntro'], 'asset:' + ids[0])
        self.assertEqual(directed['media']['creatorOutro'], 'asset:' + ids[1])
        self.assertEqual(directed['timing']['intro'], 2)
        self.assertEqual(directed['timing']['outro'], 2)
        self.assertEqual(config['creator']['introVideo'], 'asset:' + ids[0])

    def test_media_first_phrases_are_general(self):
        for brief in ['usar únicamente los medios proporcionados','usar el video y pantallazos proporcionados',
                      'la página debe ser la protagonista','no inventar pantallas','Use only provided media']:
            self.assertTrue(media_first({'project':{'creativeBrief':brief}}),brief)
        self.assertFalse(media_first({'brand':{'businessName':'CITAYA'}}))

    def test_explicit_product_routing_does_not_depend_on_brand(self):
        for brand in ['CITAYA','Agencia externa']:
            config={'brand':{'businessName':brand},'project':{'productContext':'citaya-agendas'}}
            self.assertIn('agenda',tenant_brief._director_visual_intents(config))
            config['project']['productContext']='external'
            self.assertNotIn('agenda',tenant_brief._director_visual_intents(config))
        self.assertNotIn('agenda',tenant_brief._director_visual_intents({'videoType':'website_showcase','project':{'productContext':'citaya-agendas'}}))

    def test_copy_comes_from_explicit_fields_never_visual_direction(self):
        explicit='\n'.join(k+': '+v for k,v in COPY.items())
        self.assertEqual(tenant_brief.authorized_copy({},BRIEF+'\n'+explicit),COPY)
        self.assertEqual(tenant_brief.authorized_copy({'content':COPY},BRIEF),COPY)

    def test_create_media_first_draft_does_not_promote_editorial_prose(self):
        response={'text':json.dumps(dict.fromkeys(COPY,'Vista atractiva de la portada'))}
        with patch.object(tenant_brief,'gateway_call',return_value=response):
            config,report,_=tenant_brief.generate_tenant_config(brief=BRIEF,business_name='CITAYA',
                niche='architecture',style='minimal',duration_seconds=20,video_type='website_showcase')
        self.assertEqual(config['template'],'local-business-promo-v2')
        self.assertTrue(config['mediaPolicy']['mediaFirst'])
        self.assertEqual(report['code'],'VISUAL_ANALYSIS_REQUIRED')
        self.assertNotIn('Vista atractiva',json.dumps(config['content']))
        with self.assertRaises(ConfigError):validate(config)

    def test_unknown_analysis_never_reaches_text_model(self):
        c={'product':'custom-client-video','brand':{'businessName':'Agency'},'project':{'creativeBrief':BRIEF}}
        value=observation();value.pop('evidence');value['status']='unknown'
        with patch.object(tenant_brief,'gateway_call') as call:
            with self.assertRaises(tenant_brief.TenantBriefError) as error:
                tenant_brief.direct_tenant_config(config=c,assets=[{'id':'a','assetType':'image'}],visual_inventory={'a':value})
        self.assertEqual(error.exception.code,'VISUAL_ANALYSIS_REQUIRED')
        call.assert_not_called()

    def test_balanced_extension_and_capacity_redistribution(self):
        scenes=[{'duration':2,'video':'asset:a'},{'duration':2},{'duration':2}]
        tenant_brief.distribute_scenes(scenes,15,{'a':{'durationSeconds':3}})
        self.assertEqual([s['duration'] for s in scenes],[3,6,6])
        with self.assertRaises(tenant_brief.TenantBriefError):
            tenant_brief.distribute_scenes([{'duration':2,'video':'asset:a'}],8,{'a':{'durationSeconds':3}})

    def test_model_offsets_are_conservative(self):
        proposal={**COPY,'outroSeconds':2,'scenes':[{'headline':'Diseño con identidad','visualIntent':'media',
                  'assetId':'video','durationSeconds':2,'videoOffset':1}]}
        with self.assertRaises(tenant_brief.TenantBriefError) as caught:
            tenant_brief._validate_director_proposal({'text':json.dumps(proposal)},'',{'media':'media'},
                                                     {'video':{'id':'video','type':'video'}},True)
        self.assertEqual(caught.exception.code,'DIRECTOR_SEGMENT_UNSUPPORTED')

    def test_invalid_or_generic_media_first_proposal_cannot_fall_back(self):
        value=observation();value.pop('evidence');value['status']='complete'
        c={'product':'custom-client-video','brand':{'businessName':'CITAYA'},'content':COPY,
           'project':{'creativeBrief':BRIEF},'mediaPolicy':{'mediaFirst':True}}
        for response in ['not-json',json.dumps({**COPY,'outroSeconds':2,'scenes':[{'headline':'Mostrar proyectos','visualIntent':'generic','durationSeconds':3}]})]:
            with patch.object(tenant_brief,'gateway_call',return_value={'text':response}) as model:
                with self.assertRaises(tenant_brief.TenantBriefError):
                    tenant_brief.direct_tenant_config(config=c,assets=[{'id':'visual','assetType':'image'}],visual_inventory={'visual':value})
                self.assertEqual(model.call_count,1)


if __name__=='__main__':unittest.main()
