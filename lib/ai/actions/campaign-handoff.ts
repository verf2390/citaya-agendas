export const CAMPAIGN_DRAFT_HANDOFF_STORAGE_KEY =
  "citaya-ai-campaign-draft-v1";

export type CampaignDraftHandoffV1 = {
  version: 1;
  kind: "campaign_draft";
  message: string;
};

export function createCampaignDraftHandoff(
  message: string,
): CampaignDraftHandoffV1 | null {
  const clean = message.trim();
  if (!clean || clean.length > 2_000) return null;
  return {
    version: 1,
    kind: "campaign_draft",
    message: clean,
  };
}

export function parseCampaignDraftHandoff(
  value: string | null,
): CampaignDraftHandoffV1 | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (
      record.version !== 1 ||
      record.kind !== "campaign_draft" ||
      typeof record.message !== "string"
    ) {
      return null;
    }

    return createCampaignDraftHandoff(record.message);
  } catch {
    return null;
  }
}
