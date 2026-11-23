import { headers } from "next/headers"
import { notFound } from "next/navigation"

import AdminNav from "@/components/admin/AdminNav"
import { AdminPageHeader, AdminPageShell } from "@/components/admin/admin-ui"
import { requireSettlementsDemoAdmin } from "@/lib/settlements/demo-access"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import SettlementsDemo from "./settlements-demo"

export default async function SettlementsDemoPage() {
  if (process.env.NEXT_PUBLIC_CITAYA_SETTLEMENTS_DEMO !== "true") notFound()

  const supabase = await createSupabaseServerClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) notFound()

  const requestHeaders = new Headers(await headers())
  requestHeaders.set("Authorization", `Bearer ${session.access_token}`)
  const access = await requireSettlementsDemoAdmin(new Request("http://localhost", { headers: requestHeaders }))
  if (!access.ok) notFound()

  return (
    <AdminPageShell>
      <AdminNav />
      <AdminPageHeader
        title="Liquidaciones"
        description="Calcula y guarda cierres simulados a partir de las citas de Agenda."
      />
      <SettlementsDemo />
    </AdminPageShell>
  )
}
