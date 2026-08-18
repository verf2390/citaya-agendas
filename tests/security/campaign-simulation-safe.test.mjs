import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "app/api/admin/campaigns/send/route.ts",
  "utf8",
);

const postStart = source.indexOf("export async function POST");
assert.notEqual(postStart, -1, "POST de campañas no encontrado");

const post = source.slice(postStart);

test("campaign simulation is explicit and real sends remain operationally gated", () => {
  assert.match(
    post,
    /const simulation = body\.simulation === true;/,
  );

  assert.match(
    post,
    /if \(!simulation\) \{[\s\S]*?assertTenantCanSendCampaign\(tenant\.id\)/,
  );
});

test("campaign simulation returns before every external campaign effect", () => {
  const simulationBranch = post.indexOf("if (simulation) {");
  const webhookConfigGate = post.indexOf("if (!webhookUrl)");
  const emptyAudienceGate = post.indexOf("if (recipients.length === 0)");
  const n8nFetch = post.indexOf("fetch(webhookUrl");
  const sentLog = post.indexOf('status: "sent"');

  assert.notEqual(simulationBranch, -1);
  assert.notEqual(webhookConfigGate, -1);
  assert.notEqual(emptyAudienceGate, -1);
  assert.notEqual(n8nFetch, -1);
  assert.notEqual(sentLog, -1);

  assert.ok(
    simulationBranch < webhookConfigGate,
    "simulation must not require the n8n webhook",
  );

  assert.ok(
    simulationBranch < emptyAudienceGate,
    "simulation with zero recipients must still return a safe preview",
  );

  assert.ok(
    simulationBranch < n8nFetch,
    "simulation must return before n8n fetch",
  );

  assert.ok(
    simulationBranch < sentLog,
    "simulation must return before sent-message logging",
  );

  const simulationCode = post.slice(simulationBranch, webhookConfigGate);

  assert.match(simulationCode, /simulated: true/);
  assert.match(simulationCode, /sentCount: 0/);
  assert.match(simulationCode, /recipientCount: recipients\.length/);

  assert.doesNotMatch(
    simulationCode,
    /logMessage\s*\(/,
    "simulation must not write message logs",
  );

  assert.doesNotMatch(
    simulationCode,
    /\bfetch\s*\(/,
    "simulation must not call external HTTP services",
  );
});

const uiSource = readFileSync(
  "app/admin/campanas/page.tsx",
  "utf8",
);

test("campaign UI exposes simulation separately from real sending", () => {
  assert.match(
    uiSource,
    /const \[simulating, setSimulating\] = useState\(false\)/,
  );

  assert.match(
    uiSource,
    /const sendCampaign = async \(simulation = false\)/,
  );

  assert.match(
    uiSource,
    /if \(!simulation && !confirmed\)/,
    "simulation must not require real-send confirmation",
  );

  assert.match(
    uiSource,
    /simulation,\s*mediaType,/,
    "simulation flag must be sent to the server",
  );

  assert.match(
    uiSource,
    /onClick=\{\(\) => void sendCampaign\(true\)\}/,
  );

  assert.match(
    uiSource,
    /Simular campaña/,
  );

  assert.match(
    uiSource,
    /onClick=\{\(\) => void sendCampaign\(false\)\}/,
  );

  assert.match(
    uiSource,
    /Enviar campaña/,
  );
});

test("campaign UI presents simulation without claiming messages were sent", () => {
  assert.match(
    uiSource,
    /json\.simulated === true/,
  );

  assert.match(
    uiSource,
    /type: "simulation"/,
  );

  assert.match(
    uiSource,
    /recipientCount: Number\(json\.recipientCount \?\? 0\)/,
  );

  assert.match(
    uiSource,
    /sentCount: 0/,
  );

  assert.match(
    uiSource,
    /result\.simulated \? "Mensajes enviados" : "Enviados"/,
  );
});
