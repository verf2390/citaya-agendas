import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { cases, areas } from "../scripts/ai-eval/cases.mjs";
import { evaluate, normalize, summarize, validateCases } from "../scripts/ai-eval/evaluate.mjs";

test("la batería contiene 30 casos sintéticos, seis por área, con IDs únicos", () => {
  assert.deepEqual(validateCases(), Object.fromEntries(areas.map((area) => [area, 6])));
  assert.equal(cases.length, 30);
  assert.equal(new Set(cases.map((c) => c.id)).size, 30);
});

test("evalúa sin confundir tildes ni mayúsculas; explicita revisión humana", () => {
  const item = {
    required: [["mañana"], ["reserva", "cita"]],
    forbidden: ["ya envié"],
  };
  const ok = evaluate(item, "Tu CITA es MAÑANA, consulta cualquier cambio.");
  assert.equal(ok.passed, true);
  assert.equal(ok.manualReviewRequired, true);
  assert.equal(normalize("AUTORIZACIÓN"), "autorizacion");
  const bad = evaluate(item, "Ya envié una respuesta.");
  assert.equal(bad.passed, false);
  assert.equal(bad.missing.length, 2);
  assert.equal(bad.forbiddenMatches.length, 1);
});

test("resumen separado por área y errores de conexión", () => {
  const s = summarize({ results: [
    { area: "redaccion", check: { passed: true } },
    { area: "redaccion", check: { passed: false } },
    { area: "datos", error: "Timeout", check: null },
  ] });
  assert.equal(s.evaluated, 3);
  assert.equal(s.automaticPasses, 1);
  assert.equal(s.errors, 1);
  assert.equal(s.byArea.redaccion.count, 2);
  assert.equal(s.byArea.datos.errors, 1);
});

test("runner llama al contrato Citaya en loopback, guarda archivo privado y no toca DB", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "citaya-qwen30-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let request = null;
  const server = createServer(async (req, res) => {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    request = JSON.parse(Buffer.concat(parts).toString("utf8"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      text: "Hola, te recordamos tu cita de mañana.",
      toolCalls: [],
      usage: { inputTokens: 20, outputTokens: 15, totalTokens: 35 },
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const port = server.address().port;
  const out = join(dir, "result.json");
  const child = spawn(process.execPath, [
    resolve("scripts/ai-eval/run.mjs"), "run", "--model", "test-model",
    "--endpoint", `http://127.0.0.1:${port}/v1/generate`,
    "--limit", "1", "--out", out,
  ], { cwd: resolve("."), env: { ...process.env, CITAYA_AI_LOCAL_AUTH_TOKEN: "", CITAYA_AI_GATEWAY_TOKEN: "" } });
  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr.on("data", (chunk) => logs.push(String(chunk)));
  const [exit] = await once(child, "exit");
  assert.equal(exit, 0, logs.join(""));
  assert.equal(request.contractVersion, "citaya-ai-provider-v1");
  assert.equal(request.model, "test-model");
  assert.deepEqual(request.tools, []);
  assert.equal(request.input.length, 1);
  assert.equal(request.input[0].text, cases[0].prompt);
  const saved = JSON.parse(await readFile(out, "utf8"));
  assert.equal(saved.results.length, 1);
  assert.equal(saved.results[0].check.passed, true);
  assert.equal(saved.results[0].usage.totalTokens, 35);
});

test("comparación impide cotejar muestras diferentes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "citaya-qwen30-compare-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const a = join(dir, "a.json");
  const b = join(dir, "b.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(a, JSON.stringify({ kind: "citaya-qwen30-diagnostic-v1", model: "A", results: [
    { id: "Q01", area: "redaccion", check: { passed: true } },
  ] }));
  await writeFile(b, JSON.stringify({ kind: "citaya-qwen30-diagnostic-v1", model: "B", results: [
    { id: "Q02", area: "redaccion", check: { passed: true } },
  ] }));
  const child = spawn(process.execPath, [resolve("scripts/ai-eval/run.mjs"), "compare", a, b]);
  const [exit] = await once(child, "exit");
  assert.notEqual(exit, 0);
});
