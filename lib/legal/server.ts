import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTenantSlugFromHostname } from "@/lib/tenant";

export type PublicLegalDocument = {
  id: string;
  type: string;
  version: number;
  title: string;
  hash: string;
  effectiveAt: string;
  href: string;
};

export async function getPublicLegalBundleByTenantId(
  tenantId: string,
  tenantSlug?: string,
) {
  const [{ data: tenant }, { data: profile }, { data: tax }, { data: docs }] =
    await Promise.all([
      supabaseAdmin.from("tenants")
        .select("id,slug,name,address,city,contact_email,phone_display,lifecycle_status")
        .eq("id", tenantId).eq("lifecycle_status", "active").maybeSingle(),
      supabaseAdmin.from("tenant_legal_profiles").select("*")
        .eq("tenant_id", tenantId).maybeSingle(),
      supabaseAdmin.from("dte_production_tenant_settings")
        .select("issuer_legal_name,issuer_rut,issuer_address,issuer_commune,issuer_city")
        .eq("tenant_id", tenantId).maybeSingle(),
      supabaseAdmin.from("legal_documents")
        .select("id,document_type,version,title,content_sha256,effective_at")
        .eq("owner_kind", "tenant").eq("tenant_id", tenantId)
        .eq("status", "published").lte("effective_at", new Date().toISOString()),
    ]);

  if (!tenant?.id || (tenantSlug && tenant.slug !== tenantSlug)) return null;
  const documents = Object.fromEntries((docs ?? []).map((doc) => [
    doc.document_type,
    {
      id: doc.id,
      type: doc.document_type,
      version: doc.version,
      title: doc.title,
      hash: doc.content_sha256,
      effectiveAt: doc.effective_at,
      href: `/legal/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(doc.document_type)}`,
    } satisfies PublicLegalDocument,
  ]));
  const identityComplete = Boolean(
    profile?.administrative_review_status === "complete" &&
    profile?.tenant_is_service_provider === true &&
    (profile?.trade_name || tenant.name) &&
    (profile?.contact_address || tenant.address) &&
    (profile?.support_email || tenant.contact_email) &&
    profile?.privacy_contact_name && profile?.privacy_contact_email &&
    tax?.issuer_legal_name && tax?.issuer_rut && tax?.issuer_address,
  );

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    identity: {
      complete: identityComplete,
      providerName: profile?.trade_name || tenant.name,
      legalName: tax?.issuer_legal_name ?? null,
      rut: tax?.issuer_rut ?? null,
      contactAddress: profile?.contact_address || [tenant.address, tenant.city].filter(Boolean).join(", ") || null,
      supportEmail: profile?.support_email || tenant.contact_email || null,
      supportPhone: profile?.support_phone || tenant.phone_display || null,
    },
    handlesSensitiveData: profile?.handles_sensitive_data === true,
    sensitivePurpose: profile?.sensitive_data_purpose ?? null,
    documents,
  };
}

export async function resolveTenantForPublicRequest(req: Request, requestedSlug: string) {
  const slug = requestedSlug.trim().toLowerCase();
  if (!slug) return null;
  const { data } = await supabaseAdmin.from("tenants").select("id,slug,lifecycle_status")
    .eq("slug", slug).eq("lifecycle_status", "active").maybeSingle();
  if (!data?.id) return null;

  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]?.trim().split(":")[0] ?? "";
  const hostSlug = getTenantSlugFromHostname(host);
  if (hostSlug && hostSlug !== slug) return null;
  return data;
}
