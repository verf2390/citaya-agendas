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
    templateKey: "promo" | "reactivation" | "reminder" | "pending_payment";
    segmentKey: "all" | "inactive" | "pending_payment" | "upcoming";
  };
};

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function campaignIntent(message: string) {
  const prompt = normalize(message);

  if (
    /clientes?\s+inactiv/.test(prompt) ||
    /reactiv\w*/.test(prompt) ||
    /recuperar\s+clientes?/.test(prompt)
  ) {
    return { templateKey: "reactivation", segmentKey: "inactive" } as const;
  }

  if (/pago\w*\s+pendient|pendient\w*\s+por\s+pagar/.test(prompt)) {
    return {
      templateKey: "pending_payment",
      segmentKey: "pending_payment",
    } as const;
  }

  if (/proxim\w*\s+cita|recordator\w*\s+cita/.test(prompt)) {
    return { templateKey: "reminder", segmentKey: "upcoming" } as const;
  }

  return { templateKey: "promo", segmentKey: "all" } as const;
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
  const intent = campaignIntent(input.message);

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
        templateKey: intent.templateKey,
        segmentKey: intent.segmentKey,
      },
    },
  ];
}
