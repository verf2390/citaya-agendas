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
from production import ConfigError, validate, probe, schema_validate, tenant_schema_validate
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
        self.assertEqual(provider.calls,5)

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


class EditorialContractTests(unittest.TestCase):
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
