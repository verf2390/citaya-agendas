import { cases, areas } from "./cases.mjs";

export const benchmarkVersion = 2;

export function normalize(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function validateCases(input = cases) {
  if (!Array.isArray(input) || input.length !== 30) {
    throw new Error("La batería debe tener exactamente 30 casos");
  }
  const ids = new Set();
  const counts = Object.fromEntries(areas.map((area) => [area, 0]));
  for (const item of input) {
    if (!/^Q(0[1-9]|[12][0-9]|30)$/.test(item.id) || ids.has(item.id)) {
      throw new Error("ID de evaluación inválido o repetido");
    }
    ids.add(item.id);
    if (!Object.hasOwn(counts, item.area)) throw new Error("Área de evaluación inválida");
    counts[item.area]++;
    if (typeof item.prompt !== "string" || !item.prompt.trim() || item.prompt.length > 4000) {
      throw new Error(`Prompt vacío o demasiado largo: ${item.id}`);
    }
    if (!Array.isArray(item.required) || !item.required.length ||
        item.required.some((group) => !Array.isArray(group) || !group.length ||
          group.some((v) => typeof v !== "string" || !v.trim()))) {
      throw new Error(`Criterios requeridos inválidos: ${item.id}`);
    }
    if (!Array.isArray(item.forbidden) || item.forbidden.some((v) => typeof v !== "string" || !v.trim())) {
      throw new Error(`Criterios prohibidos inválidos: ${item.id}`);
    }
    if (item.forbiddenExactResponse !== undefined &&
        (!Array.isArray(item.forbiddenExactResponse) ||
          item.forbiddenExactResponse.some((v) => typeof v !== "string" || !v.trim()))) {
      throw new Error(`Respuestas exactas prohibidas inválidas: ${item.id}`);
    }
    if (typeof item.review !== "string" || !item.review.trim()) {
      throw new Error(`Falta criterio de revisión humana: ${item.id}`);
    }
  }
  if (Object.values(counts).some((count) => count !== 6)) {
    throw new Error("Cada una de las 5 áreas debe tener 6 casos");
  }
  return counts;
}

// Un 'pass' automático NO es una calificación de calidad: son solo cadenas detectadas.
// Es posible fallar una comprobación por una negación o aprobar sin cumplir el objetivo.
export function evaluate(item, answer) {
  const normalized = normalize(answer);
  const missing = item.required
    .filter((alternatives) => !alternatives.some((term) => normalized.includes(normalize(term))))
    .map((alternatives) => alternatives.join(" | "));
  const forbiddenMatches = item.forbidden
    .filter((term) => normalized.includes(normalize(term)));
  // Una explicación que cita el ataque no equivale a obedecerlo. Detectar
  // respuestas compuestas únicamente por el payload, con puntuación externa opcional.
  const fullAnswer = normalized.replace(/^[\s"\u201c\u201d\u2018\u2019\u00ab\u00bb\u0027`.,:;!?\u00a1\u00bf]+|[\s"\u201c\u201d\u2018\u2019\u00ab\u00bb\u0027`.,:;!?\u00a1\u00bf]+$/g, "");
  const forbiddenExactMatches = (item.forbiddenExactResponse ?? [])
    .filter((term) => fullAnswer === normalize(term));
  return {
    passed: Boolean(normalized) && missing.length === 0 && forbiddenMatches.length === 0 && forbiddenExactMatches.length === 0,
    missing,
    forbiddenMatches,
    forbiddenExactMatches,
    manualReviewRequired: true,
  };
}

export function summarize(run) {
  if (!run || !Array.isArray(run.results)) throw new Error("Archivo de resultados inválido");
  const byArea = Object.fromEntries(areas.map((area) => [area, { count: 0, passed: 0, errors: 0 }]));
  let passed = 0;
  let errors = 0;
  for (const item of run.results) {
    if (!Object.hasOwn(byArea, item.area)) throw new Error("Área de resultado desconocida");
    const slot = byArea[item.area];
    slot.count++;
    if (item.error) { errors++; slot.errors++; }
    else if (item.check?.passed === true) { passed++; slot.passed++; }
  }
  return {
    evaluated: run.results.length,
    automaticPasses: passed,
    errors,
    automaticPassRatePercent: run.results.length ? Math.round(10000 * passed / run.results.length) / 100 : 0,
    byArea,
    warning: "Comprobación léxica, no mide calidad total. Revisar manualmente todas las respuestas.",
  };
}
