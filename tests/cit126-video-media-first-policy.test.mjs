import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mediaFirstEnabled, mediaFirstPolicy } from '../lib/video/mediaFirstPolicy.mjs';

const roundTrip = (config) => JSON.parse(JSON.stringify(config));
const save = (config, checked) => roundTrip({ ...config, mediaPolicy: mediaFirstPolicy(config, checked) });

test('checkbox policy survives save, reload and editing other fields', () => {
  const original = { videoType: 'promotion', project: { creativeBrief: 'Presenta el proyecto.' },
    mediaPolicy: { useOnlyProvidedAssets: true, allowStockMedia: false, allowGeneratedMedia: false } };
  const created = save(original, true);
  assert.equal(created.mediaPolicy.mediaFirst, true);
  const reopened = roundTrip(created);
  assert.equal(mediaFirstEnabled(reopened), true);
  const edited = save({ ...reopened, content: { hook: 'Nuevo hook' } }, mediaFirstEnabled(reopened));
  assert.equal(edited.mediaPolicy.mediaFirst, true);
  assert.equal(edited.mediaPolicy.allowStockMedia, false);
  assert.equal(edited.project.creativeBrief, original.project.creativeBrief);
  assert.equal(original.mediaPolicy.mediaFirst, undefined);
});

test('website policy is mandatory with an absent or false flag, including Agenda context', () => {
  for (const mediaPolicy of [undefined, { mediaFirst: false }]) {
    const config = { videoType: 'website_showcase', mediaPolicy,
      project: { productContext: 'citaya-agendas', creativeBrief: 'Presenta el proyecto.' } };
    assert.equal(mediaFirstEnabled(config), true);
    assert.equal(save(config, false).mediaPolicy.mediaFirst, true);
  }
});

test('normal legacy projects remain optional and the checkbox works with unrecognized text', () => {
  const config = { videoType: 'promotion', project: { creativeBrief: 'Usa solamente el material que te mandé.' } };
  assert.equal(mediaFirstEnabled(config), false);
  assert.equal(save(config, false).mediaPolicy.mediaFirst, false);
  assert.equal(mediaFirstEnabled(save(config, true)), true);
  assert.equal(mediaFirstEnabled(save(save(config, true), false)), false);
});

test('panel and create API wire the canonical policy without substituting analysis consent', () => {
  const page = readFileSync('app/admin/videos/page.tsx', 'utf8');
  const route = readFileSync('app/api/admin/videos/route.ts', 'utf8');
  assert.match(page, /setMediaFirst\(mediaFirstEnabled\(next\.config\)\)/);
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
