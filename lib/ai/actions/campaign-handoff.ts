export const CAMPAIGN_DRAFT_HANDOFF_STORAGE_KEY =
  "citaya-ai-campaign-draft-v2";

export type CampaignDraftHandoffV2 = {
  version: 2;
  kind: "campaign_draft";
  message: string;
  templateKey: "promo" | "reactivation" | "reminder" | "pending_payment";
  segmentKey: "all" | "inactive" | "pending_payment" | "upcoming";
};

const TEMPLATE_KEYS = new Set([
  "promo",
  "reactivation",
  "reminder",
  "pending_payment",
]);

const SEGMENT_KEYS = new Set([
  "all",
  "inactive",
  "pending_payment",
  "upcoming",
]);

export function createCampaignDraftHandoff(input: {
  message: string;
  templateKey: CampaignDraftHandoffV2["templateKey"];
  segmentKey: CampaignDraftHandoffV2["segmentKey"];
}): CampaignDraftHandoffV2 | null {
  const clean = input.message.trim();
  if (!clean || clean.length > 2_000) return null;
  if (!TEMPLATE_KEYS.has(input.templateKey)) return null;
  if (!SEGMENT_KEYS.has(input.segmentKey)) return null;

  return {
    version: 2,
    kind: "campaign_draft",
    message: clean,
    templateKey: input.templateKey,
    segmentKey: input.segmentKey,
  };
}

export function parseCampaignDraftHandoff(
  value: string | null,
): CampaignDraftHandoffV2 | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (
      record.version !== 2 ||
      record.kind !== "campaign_draft" ||
      typeof record.message !== "string" ||
      typeof record.templateKey !== "string" ||
      typeof record.segmentKey !== "string" ||
      !TEMPLATE_KEYS.has(record.templateKey) ||
      !SEGMENT_KEYS.has(record.segmentKey)
    ) {
      return null;
    }

    return createCampaignDraftHandoff({
      message: record.message,
      templateKey:
        record.templateKey as CampaignDraftHandoffV2["templateKey"],
      segmentKey: record.segmentKey as CampaignDraftHandoffV2["segmentKey"],
    });
  } catch {
    return null;
  }
}
