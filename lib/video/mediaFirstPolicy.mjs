// Explicit persisted choice only; effective policy comes from Python.
export function structuredMediaFirst(config) {
  return config?.mediaPolicy?.mediaFirst === true;
}

export function mediaFirstPolicy(config, selected) {
  return {
    ...config?.mediaPolicy,
    mediaFirst: selected === true,
  };
}

export function mediaFirstDraft(brief, projectKind, selected) {
  const creativeBrief = brief.trim();
  return { product: 'custom-client-video',
    videoType: projectKind === 'website_showcase' ? 'website_showcase' : 'promotion',
    mediaPolicy: { mediaFirst: selected === true }, project: creativeBrief ? { creativeBrief } : {} };
}

// Cancel stale replies; the UI also keys each result to the exact draft inputs.
export function requestMediaFirstState({ config, request, onResult, delay = 400,
  schedule = setTimeout, cancel = clearTimeout }) {
  let active = true;
  const key = JSON.stringify(config);
  const timer = schedule(async () => {
    try {
      const response = await request({ action: 'media_first_state', config });
      if (active) onResult({ key, state: response.mediaFirstState, error: false });
    } catch {
      if (active) onResult({ key, state: null, error: true });
    }
  }, delay);
  return () => { active = false; cancel(timer); };
}

export function mediaFirstStatus(result, key) {
  if (!result || result.key !== key) return 'Comprobando uso de medios…';
  if (result.error) return 'No se pudo comprobar el uso de medios. Modifica el brief o recarga para reintentar.';
  const messages = {
    structured: 'Uso exclusivo de medios activado manualmente.',
    website_showcase: 'Uso exclusivo de medios obligatorio para videos de muestra web.',
    brief: 'Uso exclusivo de medios activado por las instrucciones del brief.',
    none: 'Uso exclusivo de medios desactivado.',
  };
  return messages[result.state?.source] || 'No se pudo comprobar el uso de medios.';
}
