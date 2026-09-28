export type CitayaAppProposedAction = {
  id: "campaign_draft_v1";
  kind: "campaign_draft";
  title: string;
  summary: string;
  requiresConfirmation: true;
  target: {
    path: "/admin/campanas";
  };
  preview: {
    message: string;
  };
};

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isCampaignDraftRequest(message: string) {
  const prompt = normalize(message);
  const draftingIntent =
    /\b(redact|escrib|borrador|prepara|crea|genera|haz|mensaje)\w*/.test(
      prompt,
    );
  const campaignContext =
    /\b(campan|reactiv|marketing|promocion)\w*/.test(prompt) ||
    /clientes?\s+inactiv/.test(prompt) ||
    /recuperar\s+clientes?/.test(prompt);

  return draftingIntent && campaignContext;
}

export function proposeCitayaAppActions(input: {
  message: string;
  answer: string;
}): CitayaAppProposedAction[] {
  const draft = input.answer.trim().slice(0, 2_000);
  if (!draft || !isCampaignDraftRequest(input.message)) return [];

  return [
    {
      id: "campaign_draft_v1",
      kind: "campaign_draft",
      title: "Revisar borrador en Campañas",
      summary:
        "Abre el editor de campañas para revisar el borrador antes de cualquier envío.",
      requiresConfirmation: true,
      target: {
        path: "/admin/campanas",
      },
      preview: {
        message: draft,
      },
    },
  ];
}
