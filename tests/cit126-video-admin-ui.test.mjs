import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const page = readFileSync(resolve("app/admin/videos/page.tsx"), "utf8");
const nav = readFileSync(resolve("components/admin/AdminNav.tsx"), "utf8");

test("Video Studio navigation is visible only for rg-spa", () => {
  assert.match(nav, /href: "\/admin\/videos"/);
  assert.match(nav, /label: "Videos"/);
  assert.match(nav, /tenantOnly: "rg-spa"/);
  assert.match(nav, /item\.tenantOnly === tenant\?\.slug/);
});

test("Video Studio UI exposes the reviewed production flow", () => {
  for (const marker of [
    "create_from_brief",
    "Subir material",
    "Video de inicio",
    "Video de cierre",
    "Voz / narración",
    "Música de fondo",
    "Guardar edición",
    "Generar preview",
    "Aprobar preview",
    "Generar final 1080p",
    "Descargar MP4",
  ]) {
    assert.match(page, new RegExp(marker));
  }
  assert.match(page, /rightsApproved/);
  assert.match(page, /mediaApproved/);
  assert.match(page, /Idempotency-Key/);
});

test("Video Studio UI uses authenticated adminFetch without tenant hints", () => {
  assert.match(page, /adminFetch/);
  assert.doesNotMatch(page, /tenantId\s*:/);
  assert.doesNotMatch(page, /userId\s*:/);
  assert.doesNotMatch(page, /fetch\("/);
});

test("Video Studio media controls wire supported audio and creator roles", () => {
  assert.match(page, /creatorIntro/);
  assert.match(page, /creatorOutro/);
  assert.match(page, /clientVoiceover/);
  assert.match(page, /backgroundMusic/);
  assert.match(page, /Logo \/ imagen de marca/);
  assert.match(page, /logoAssetId/);
  assert.match(page, /logo: logoAssetId \? "asset:" \+ logoAssetId : null/);
  assert.match(page, /duckMusicDuringVoice/);
  assert.match(page, /existingTts\.enabled === true/);
  assert.match(page, /useClipAudio/);
  assert.match(page, /reservedImages/);
  assert.match(page, /\.wav,.mp3,.m4a,.ogg/);
});

test("Preview player forces browser-compatible MP4 blob and reports media errors", () => {
  assert.match(page, /response\.arrayBuffer\(\)/);
  assert.match(page, /new Blob\(\[bytes\], \{ type: "video\/mp4" \}\)/);
  assert.match(page, /preload="metadata"/);
  assert.match(page, /key=\{previewUrl\}/);
  assert.match(page, /onError=/);
});

test("Video Studio accepts a free-form niche and longer creative briefs", () => {
  assert.match(page, /list="video-studio-niches"/);
  assert.match(page, /nicheLabel: niche\.trim\(\)/);
  assert.match(page, /maxLength=\{6000\}/);
});


test("Video Studio exposes a post-upload guarded AI director", () => {
  assert.match(page, /Dirigir con IA/);
  assert.match(page, /action: "direct"/);
  assert.match(page, /directWithAi/);
  assert.match(page, /creativeBrief/);
  assert.match(page, /prioriza no cortarlos/);
});


test("Video Studio surfaces legacy ambiguous config errors clearly", () => {
  assert.match(page, /AMBIGUOUS_CONFIG/);
  assert.match(page, /campos duplicados/);
});


test("Video Studio persists the editable niche as the rendered project category", () => {
  assert.match(page, /setNiche\(projectMeta\.category\)/);
  assert.match(page, /category: niche\.trim\(\) \|\| "Negocio local"/);
});
