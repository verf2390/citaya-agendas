import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return {
        url: pathToFileURL(resolve(`${specifier.slice(2)}.ts`)).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  CAMPAIGN_DRAFT_HANDOFF_STORAGE_KEY,
  createCampaignDraftHandoff,
  parseCampaignDraftHandoff,
} = await import(
  pathToFileURL(resolve("lib/ai/actions/campaign-handoff.ts")).href
);

const assistantPage = readFileSync(
  resolve("app/admin/asistente/page.tsx"),
  "utf8",
);
const campaignPage = readFileSync(
  resolve("app/admin/campanas/page.tsx"),
  "utf8",
);

test("handoff de campaña acepta solo payload v1 acotado", () => {
  const handoff = createCampaignDraftHandoff({
    message: "  Hola, vuelve a reservar.  ",
    templateKey: "reactivation",
    segmentKey: "inactive",
  });
  assert.deepEqual(handoff, {
    version: 2,
    kind: "campaign_draft",
    message: "Hola, vuelve a reservar.",
    templateKey: "reactivation",
    segmentKey: "inactive",
  });
  assert.deepEqual(
    parseCampaignDraftHandoff(JSON.stringify(handoff)),
    handoff,
  );
  assert.equal(
    parseCampaignDraftHandoff(
      '{"version":2,"kind":"campaign_draft","message":"x","templateKey":"promo","segmentKey":"not_allowed"}',
    ),
    null,
  );
  assert.equal(parseCampaignDraftHandoff("not-json"), null);
  assert.equal(
    createCampaignDraftHandoff({
      message: "",
      templateKey: "promo",
      segmentKey: "all",
    }),
    null,
  );
  assert.equal(
    createCampaignDraftHandoff({
      message: "x".repeat(2_001),
      templateKey: "promo",
      segmentKey: "all",
    }),
    null,
  );
});

test("asistente solo hace handoff local y nunca envía campañas", () => {
  assert.match(assistantPage, /window\.sessionStorage\.setItem/);
  assert.match(assistantPage, /CAMPAIGN_DRAFT_HANDOFF_STORAGE_KEY/);
  assert.match(assistantPage, /router\.push\(action\.target\.path\)/);
  assert.match(assistantPage, /requiresConfirmation !== true/);
  assert.doesNotMatch(assistantPage, /\/api\/admin\/campaigns\/send/);
});

test("campañas consume el borrador una vez y conserva confirmación humana", () => {
  assert.match(campaignPage, /if \(!authChecked\) return/);
  assert.match(campaignPage, /window\.sessionStorage\.getItem/);
  assert.match(campaignPage, /window\.sessionStorage\.removeItem/);
  assert.match(campaignPage, /parseCampaignDraftHandoff/);
  assert.match(campaignPage, /setTemplateKey\(handoff\.templateKey\)/);
  assert.match(campaignPage, /setSegmentKey\(handoff\.segmentKey\)/);
  assert.match(campaignPage, /setSubject\(template\.subject\)/);
  assert.match(campaignPage, /setHeadline\(template\.headline\)/);
  assert.match(campaignPage, /setMessage\(handoff\.message\)/);
  assert.match(campaignPage, /setCtaLabel\(template\.ctaLabel\)/);
  assert.match(campaignPage, /setConfirmed\(false\)/);
  assert.match(
    campaignPage,
    /Confirma el envío antes de continuar/,
  );
});

test("storage key no contiene tenant ni contenido del borrador", () => {
  assert.equal(
    CAMPAIGN_DRAFT_HANDOFF_STORAGE_KEY,
    "citaya-ai-campaign-draft-v2",
  );
  assert.doesNotMatch(CAMPAIGN_DRAFT_HANDOFF_STORAGE_KEY, /tenant|message|prompt/i);
});
