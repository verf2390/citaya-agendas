import assert from 'node:assert/strict';
import test from 'node:test';
import { directAfterAnalysis } from '../lib/video/directorFlow.mjs';

const saved = {config: {media: {images: ['asset:img'], videos: ['asset:vid'], clientVoiceover: 'asset:voice'}},
  assets: [{id: 'img', assetType: 'image'}, {id: 'vid', assetType: 'video'}, {id: 'voice', assetType: 'audio'}, {id: 'unselected', assetType: 'image'}]};

test('real panel flow saves, approves exactly selected visuals, waits for analysis, then directs', async () => {
  const calls = [], states = [];
  const result = await directAfterAnalysis({projectId: 'project', brief: 'website', analysisConsent: true,
    save: async () => { calls.push('save'); return saved; }, onStatus: (s) => states.push(s), wait: async () => {},
    request: async (body) => {
      calls.push(body);
      if (body.action === 'prepare_direction') return {status: 'analyzing', analysisJobId: 'job'};
      if (body.action === 'direction_analysis_status') return {status: 'ready', visualAssetCount: 2};
      return {project: 'directed'};
    }});
  assert.deepEqual(calls.map(c => c.action || c), ['save','prepare_direction','direction_analysis_status','direct']);
  assert.deepEqual(calls[1].assetIds, ['img','vid']);
  assert.equal(calls[1].analysisConsent, true);
  assert.ok(states.includes('Analizando medios…'));
  assert.equal(states.at(-1), 'Medios analizados. Dirigiendo con IA…');
  assert.equal(result.project, 'directed');
});

for (const failedAction of ['prepare_direction', 'direction_analysis_status']) {
  test(`analysis failure at ${failedAction} never invokes Director`, async () => {
    const calls = [];
    await assert.rejects(directAfterAnalysis({projectId: 'project', brief: 'brief', analysisConsent: false,
      save: async () => saved, onStatus: () => {}, wait: async () => {}, request: async (body) => {
        calls.push(body.action);
        if (body.action === failedAction) throw new Error('Falló análisis visual');
        return {status: 'analyzing', analysisJobId: 'job'};
      }}), /Falló análisis visual/);
    assert.ok(!calls.includes('direct'));
  });
}

test('already analyzed set skips polling without claiming new analysis occurred', async () => {
  const calls = [];
  await directAfterAnalysis({projectId: 'p', brief: 'b', analysisConsent: false, save: async () => saved,
    onStatus: () => {}, wait: async () => assert.fail('No polling required'), request: async (b) => {
      calls.push(b.action); return {status: 'ready', visualAssetCount: 2};
    }});
  assert.deepEqual(calls, ['prepare_direction','direct']);
});

for (const status of ['failed', 'cancelled']) {
  test(`terminal ${status} response stops polling and offers retry`, async () => {
    const calls = [];
    await assert.rejects(directAfterAnalysis({projectId: 'p', brief: 'b', analysisConsent: true,
      save: async () => saved, onStatus: () => {}, wait: async () => {}, request: async (body) => {
        calls.push(body.action);
        return body.action === 'prepare_direction' ? {status: 'analyzing', analysisJobId: 'job'} :
          {status, error: '/private/path and sensitive provider response'};
      }}), /No se pudieron analizar los medios\. Reintenta/);
    assert.deepEqual(calls, ['prepare_direction', 'direction_analysis_status']);
  });
}

for (const code of ['ANALYSIS_START_FAILED', 'ANALYSIS_QUEUE_TIMEOUT', 'LEASE_EXPIRED']) {
  test(`${code} from the backend ends the flow without a new enqueue or Director`, async () => {
    const calls = [], states = [];
    await assert.rejects(directAfterAnalysis({projectId: 'p', brief: 'b', analysisConsent: true,
      save: async () => saved, onStatus: s => states.push(s), wait: async () => {}, request: async body => {
        calls.push(body.action);
        if (body.action === 'direction_analysis_status') throw new Error(`${code}: Reintenta Dirigir con IA.`);
        return {status: 'analyzing', analysisJobId: 'job', analysisState: 'queued'};
      }}), new RegExp(code));
    assert.deepEqual(calls, ['prepare_direction', 'direction_analysis_status']);
    assert.ok(states.includes('Analizando medios…'));
  });
}

test('a legitimately running inference has no browser deadline and completes after many polls', async () => {
  let polls = 0, prepares = 0, directs = 0;
  await directAfterAnalysis({projectId: 'p', brief: 'b', analysisConsent: true,
    save: async () => saved, onStatus: () => {}, wait: async () => {}, request: async body => {
      if (body.action === 'prepare_direction') prepares++;
      if (body.action === 'direction_analysis_status' && ++polls === 1000) {
        return {status: 'ready', visualAssetCount: 2};
      }
      if (body.action === 'direct') { directs++; return {project: 'complete'}; }
      return {status: 'analyzing', analysisJobId: 'job', analysisState: 'running'};
    }});
  assert.equal(polls, 1000);
  assert.equal(prepares, 1);
  assert.equal(directs, 1);
});

// These functions are also used by saveConfig and refresh in the actual panel.
const { applyProjectKind, mediaReferences, shouldSyncEditor } = await import('../lib/video/directorFlow.mjs');
test('website selection survives refresh, saves before analysis and keeps navigation as ordinary media', async () => {
  const config = {videoType: 'promotion', template: 'local-business-promo-v2', media: {clientVoiceover: 'asset:voice'}};
  assert.equal(shouldSyncEditor('project', 'project', 'website_showcase'), false);
  assert.equal(shouldSyncEditor('project', 'other', 'website_showcase'), true);
  assert.equal(shouldSyncEditor('project', 'project', 'external'), true);
  const assets = [1,2,3,4].map(i => ({id: `image-${i}`, assetType: 'image'}))
    .concat([{id: 'navigation', assetType: 'video', durationMs: 19167}, {id: 'voice', assetType: 'audio', durationMs: 10133}]);
  await directAfterAnalysis({projectId: 'project', brief: 'Sitio web', analysisConsent: true, onStatus() {},
    save: async () => {
      applyProjectKind(config, 'website_showcase');
      config.media = {...config.media, ...mediaReferences(assets, '', '', ''), creatorIntro: null, creatorOutro: null};
      return {config, assets};
    }, request: async body => {
      assert.equal(config.videoType, 'website_showcase');
      assert.equal(config.template, 'website-showcase-v2');
      assert.equal(config.media.clientVoiceover, 'asset:voice');
      assert.deepEqual(config.media.videos, ['asset:navigation']);
      assert.equal(config.media.creatorIntro, null);
      if (body.action === 'prepare_direction') {
        assert.deepEqual(body.assetIds, ['image-1','image-2','image-3','image-4','navigation']);
        assert.equal(body.analysisConsent, true);
        return {status: 'ready', visualAssetCount: 5};
      }
      assert.equal(body.action, 'direct');
      return {project: {config}};
    }});
});

test('only explicit creator assignments reserve a video; leaving website restores business routing', () => {
  const assets = [{id: 'intro', assetType: 'video'}, {id: 'navigation', assetType: 'video'}];
  assert.deepEqual(mediaReferences(assets, '', '', '').videos, ['asset:intro','asset:navigation']);
  assert.deepEqual(mediaReferences(assets, 'intro', '', '').videos, ['asset:navigation']);
  const config = {template: 'website-showcase-v2'};
  applyProjectKind(config, 'external');
  assert.equal(config.videoType, 'promotion');
  assert.equal(config.template, 'local-business-promo-v2');
});