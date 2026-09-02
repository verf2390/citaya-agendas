import Link from "next/link";
import { notFound } from "next/navigation";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

const PUBLIC_TYPES = new Set([
  "consumer_terms",
  "privacy_notice",
  "cancellation_refund_policy",
  "sensitive_data_authorization",
]);

export const dynamic = "force-dynamic";

export default async function PublicLegalDocumentPage({
  params,
}: {
  params: Promise<{ slug: string; type: string }>;
}) {
  const resolvedParams = await params;
  if (!PUBLIC_TYPES.has(resolvedParams.type)) notFound();
  const { data: tenant } = await supabaseAdmin.from("tenants")
    .select("id,slug,name").eq("slug", resolvedParams.slug).maybeSingle();
  if (!tenant?.id) notFound();
  const { data: document } = await supabaseAdmin.from("legal_documents")
    .select("title,content,version,effective_at")
    .eq("owner_kind", "tenant").eq("tenant_id", tenant.id)
    .eq("document_type", resolvedParams.type).eq("status", "published")
    .lte("effective_at", new Date().toISOString()).maybeSingle();
  if (!document) notFound();

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-5 py-10 text-slate-900 sm:px-8">
      <Link href={`/tenants/${encodeURIComponent(tenant.slug)}/reservar`} className="text-sm font-bold text-sky-700">
        ← Volver a la reserva
      </Link>
      <p className="mt-8 text-xs font-black uppercase tracking-wider text-slate-500">
        {tenant.name} · versión {document.version}
      </p>
      <h1 className="mt-2 text-3xl font-black">{document.title}</h1>
      <p className="mt-2 text-sm text-slate-500">
        Vigente desde {new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date(document.effective_at))}
      </p>
      <article className="mt-8 whitespace-pre-wrap text-sm leading-7 text-slate-700">
        {document.content}
      </article>
    </main>
  );
}
