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
