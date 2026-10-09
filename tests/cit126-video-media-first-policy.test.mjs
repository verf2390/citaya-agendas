import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { mediaFirstPolicy, structuredMediaFirst, mediaFirstDraft,
  requestMediaFirstState, mediaFirstStatus } from '../lib/video/mediaFirstPolicy.mjs';

const roundTrip = (config) => JSON.parse(JSON.stringify(config));
const save = (config, checked) => roundTrip({ ...config, mediaPolicy: mediaFirstPolicy(config, checked) });

test('checkbox policy survives save, reload and editing other fields', () => {
  const original = { videoType: 'promotion', project: { creativeBrief: 'Presenta el proyecto.' },
    mediaPolicy: { useOnlyProvidedAssets: true, allowStockMedia: false, allowGeneratedMedia: false } };
  const created = save(original, true);
  assert.equal(created.mediaPolicy.mediaFirst, true);
  const reopened = roundTrip(created);
  assert.equal(structuredMediaFirst(reopened), true);
  const edited = save({ ...reopened, content: { hook: 'Nuevo hook' } }, structuredMediaFirst(reopened));
  assert.equal(edited.mediaPolicy.mediaFirst, true);
  assert.equal(edited.mediaPolicy.allowStockMedia, false);
  assert.equal(edited.project.creativeBrief, original.project.creativeBrief);
  assert.equal(original.mediaPolicy.mediaFirst, undefined);
});

test('website policy is mandatory with an absent or false flag, including Agenda context', () => {
  for (const mediaPolicy of [undefined, { mediaFirst: false }]) {
    const config = { videoType: 'website_showcase', mediaPolicy,
      project: { productContext: 'citaya-agendas', creativeBrief: 'Presenta el proyecto.' } };
    assert.equal(save(config, false).mediaPolicy.mediaFirst, false);
    assert.equal(structuredMediaFirst(config), false);
    assert.equal(save(config, false).videoType, 'website_showcase');
  }
});

test('normal legacy projects remain optional and the checkbox works with unrecognized text', () => {
  const config = { videoType: 'promotion', project: { creativeBrief: 'Usa solamente el material que te mandé.' } };
  assert.equal(structuredMediaFirst(config), false);
  assert.equal(save(config, false).mediaPolicy.mediaFirst, false);
  assert.equal(structuredMediaFirst(save(config, true)), true);
  assert.equal(structuredMediaFirst(save(save(config, true), false)), false);
});

test('panel and create API wire the canonical policy without substituting analysis consent', () => {
  const page = readFileSync('app/admin/videos/page.tsx', 'utf8');
  const route = readFileSync('app/api/admin/videos/route.ts', 'utf8');
  assert.match(page, /setMediaFirst\(structuredMediaFirst\(next\.config\)\)/);
  assert.match(page, /config\.mediaPolicy = mediaFirstPolicy\(config, mediaFirst\)/);
  assert.match(page, /mediaPolicy: mediaFirstPolicy\(\{ videoType: createProjectKind \}, createMediaFirst\)/);
  assert.match(page, /checked=\{mediaFirst \|\| projectKind === "website_showcase"\}/);
  assert.match(page, /disabled=\{Boolean\(working\) \|\| projectKind === "website_showcase"\}/);
  assert.match(page, /checked=\{createMediaFirst \|\| createProjectKind === "website_showcase"\}/);
  assert.match(page, /disabled=\{Boolean\(working\) \|\| createProjectKind === "website_showcase"\}/);
  assert.match(page, /setProjectKind\(next\.config\.videoType === "website_showcase" \? "website_showcase" : projectMeta\.productContext/);
  assert.match(page, /Usar únicamente los medios proporcionados/);
  assert.match(page, /checked=\{analysisConsent\}/);
  assert.match(route, /mediaPolicy: \{ mediaFirst: body\?\.mediaPolicy\?\.mediaFirst \?\? false \}/);
});

test('update API forwards omission and explicit false without applying creation defaults', () => {
  const route = readFileSync('app/api/admin/videos/route.ts', 'utf8');
  const update = route.slice(route.indexOf('if (action === "update")'), route.indexOf('if (action === "validate")'));
  assert.match(update, /action: "update_project"/);
  assert.match(update, /payload: \{ projectId: body\?\.projectId, config: body\?\.config \}/);
  assert.doesNotMatch(update, /mediaFirst:\s*[^\n]*\?\?|JSON\.stringify|Object\.assign/);
});

test('canonical Python results distinguish the explicit checkbox from effective policy', () => {
  const positive = 'Usa solo los archivos adjuntos.';
  const configs = [
    mediaFirstDraft('Presenta el proyecto.', 'external', true),
    mediaFirstDraft(positive, 'external', false),
    mediaFirstDraft('Presenta el proyecto.', 'external', false),
    mediaFirstDraft('', 'website_showcase', false),
    { product: 'custom-client-video', videoType: 'website_showcase' },
    mediaFirstDraft(positive, 'external', true),
    mediaFirstDraft(positive, 'website_showcase', true),
  ];
  const states = JSON.parse(execFileSync('python3', ['-B', '-c',
    'import sys,json; sys.path.insert(0,sys.argv[1]); from editorial_contract import media_first_state; print(json.dumps([media_first_state(c) for c in json.load(sys.stdin)]))',
    resolve('video-production/scripts')], { input: JSON.stringify(configs), encoding: 'utf8' }));
  const expected = [[true, true, 'structured'], [false, true, 'brief'],
    [false, false, 'none'], [false, true, 'website_showcase'],
    [false, true, 'website_showcase'], [true, true, 'structured'],
    [true, true, 'website_showcase']];
  states.forEach((state, i) => {
    assert.deepEqual([state.structured, state.effectiveMediaFirst, state.source], expected[i]);
    assert.equal(structuredMediaFirst(configs[i]), state.structured);
    const key = JSON.stringify(configs[i]);
    const label = mediaFirstStatus({ key, state, error: false }, key);
    assert.match(label, /manualmente|instrucciones del brief|desactivado|obligatorio/);
  });
  assert.equal(structuredMediaFirst(save(configs[1], false)), false);
  assert.equal(structuredMediaFirst(save({ ...configs[0], content: { hook: 'Otro' } }, true)), true);
  assert.deepEqual(mediaFirstDraft('  ', 'external', false).project, {});
});

test('brief transitions use server results, hide stale state and ignore canceled responses', async () => {
  const positive = mediaFirstDraft('Usa solo los archivos adjuntos.', 'external', false);
  const neutral = mediaFirstDraft('Presenta el proyecto.', 'external', false);
  const emitted = [];
  const pending = [];
  const tasks = [];
  const request = (payload) => new Promise((resolveResponse) => pending.push({ payload, resolveResponse }));
  const start = (config) => requestMediaFirstState({ config, request,
    onResult: (result) => emitted.push(result), schedule: (task) => tasks.push(task), cancel: () => {} });
  const briefState = { structured: false, effectiveMediaFirst: true, source: 'brief' };
  const neutralState = { structured: false, effectiveMediaFirst: false, source: 'none' };

  const cancelOld = start(positive);
  const oldRequest = tasks.shift()();
  cancelOld();
  const cancelNeutral = start(neutral);
  const neutralRequest = tasks.shift()();
  assert.equal(pending[1].payload.action, 'media_first_state');
  assert.deepEqual(pending[1].payload.config, neutral);
  pending[1].resolveResponse({ mediaFirstState: neutralState });
  await neutralRequest;
  assert.match(mediaFirstStatus(emitted.at(-1), JSON.stringify(neutral)), /desactivado/);
  pending[0].resolveResponse({ mediaFirstState: briefState });
  await oldRequest;
  assert.equal(emitted.length, 1);

  assert.match(mediaFirstStatus(emitted.at(-1), JSON.stringify(positive)), /Comprobando/);
  cancelNeutral();
  const cancelPositive = start(positive);
  const newRequest = tasks.shift()();
  pending[2].resolveResponse({ mediaFirstState: briefState });
  await newRequest;
  assert.match(mediaFirstStatus(emitted.at(-1), JSON.stringify(positive)), /instrucciones del brief/);
  assert.equal(structuredMediaFirst(pending[2].payload.config), false);
  cancelPositive();
});

test('debounce cleanup cancels pending work and failures do not reuse a previous result', async () => {
  const config = mediaFirstDraft('', 'external', false);
  let task;
  let canceled;
  let result;
  const cleanup = requestMediaFirstState({ config,
    request: async () => { throw new Error('Unavailable'); }, onResult: (value) => { result = value; },
    schedule: (callback, delay) => { task = callback; assert.equal(delay, 400); return 123; },
    cancel: (timer) => { canceled = timer; } });
  await task();
  assert.equal(result.state, null);
  assert.match(mediaFirstStatus(result, JSON.stringify(config)), /No se pudo comprobar/);
  cleanup();
  assert.equal(canceled, 123);
  assert.match(mediaFirstStatus(null, JSON.stringify(config)), /Comprobando/);
});

test('both UI forms ask the authenticated backend; JS contains no textual detector', () => {
  const page = readFileSync('app/admin/videos/page.tsx', 'utf8');
  const route = readFileSync('app/api/admin/videos/route.ts', 'utf8');
  const helper = readFileSync('lib/video/mediaFirstPolicy.mjs', 'utf8');
  const bridge = readFileSync('video-production/backend/bridge.py', 'utf8');
  assert.match(page, /createPolicyStatus = useMediaFirstStatus/);
  assert.match(page, /editPolicyStatus = useMediaFirstStatus/);
  assert.match(page, /aria-live="polite"[^\n]*\{createPolicyStatus\}/);
  assert.match(page, /aria-live="polite"[^\n]*\{editPolicyStatus\}/);
  assert.match(route, /action === "media_first_state"/);
  assert.match(route, /action: "media_first_state",\s*tenantId: access.tenantId,\s*userId: access.userId/);
  assert.match(bridge, /from editorial_contract import media_first_state/);
  assert.match(bridge, /media_first_state\(config\)/);
  assert.doesNotMatch(helper, /RegExp|\.match\(|\.test\(|\.normalize\(|proporcion|adjunt|unicamente|exclusivamente/);
});
