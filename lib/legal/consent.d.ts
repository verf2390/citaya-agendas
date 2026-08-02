export type LegalDocumentRef = {
  id: string;
  version: number;
  hash: string;
  title: string;
  href?: string;
};

export type PublicLegalConsent = Record<string, unknown> & {
  marketing?: { accepted: boolean; channel: "email"; purpose: string };
};

export function validatePublicLegalConsent(input: {
  tenantId: string;
  bundle: {
    tenantId: string;
    identity?: { complete?: boolean };
    handlesSensitiveData?: boolean;
    documents?: Record<string, LegalDocumentRef>;
  };
  consent: PublicLegalConsent | null | undefined;
}): { ok: true; value: PublicLegalConsent } | { ok: false; error: string };
