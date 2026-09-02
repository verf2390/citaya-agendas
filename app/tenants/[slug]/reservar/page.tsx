import ReservarPage from "@/app/reservar/page";

export default async function TenantReservarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ReservarPage tenantSlug={slug} />;
}
