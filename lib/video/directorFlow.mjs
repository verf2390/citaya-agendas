/** Run the panel's save → approval/analysis → direction flow. Never fall back on failure. */
export async function directAfterAnalysis({ save, request, projectId, brief, analysisConsent, onStatus,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  onStatus("Guardando edición…");
  const saved = await save();
  const refs = new Set();
  const visit = (value) => {
    if (typeof value === "string" && value.startsWith("asset:")) refs.add(value.slice(6));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(saved.config);
  const assetIds = saved.assets.filter((a) => refs.has(a.id) && ["image", "video"].includes(a.assetType)).map((a) => a.id).sort();
  onStatus("Comprobando análisis visual…");
  let analysis = await request({ action: "prepare_direction", projectId, assetIds, analysisConsent });
  while (analysis.status === "analyzing") {
    onStatus("Analizando medios…");
    await wait(3000);
    analysis = await request({ action: "direction_analysis_status", projectId, analysisJobId: analysis.analysisJobId });
  }
  if (analysis.status !== "ready") {
    // Backend decides queue expiry/lease loss. No browser deadline on a
    // legitimately running inference; every terminal failure stops this flow.
    throw new Error("No se pudieron analizar los medios. Reintenta Dirigir con IA.");
  }
  onStatus(analysis.visualAssetCount > 0 ? "Medios analizados. Dirigiendo con IA…" : "Dirigiendo con IA…");
  return request({ action: "direct", projectId, brief });
}
