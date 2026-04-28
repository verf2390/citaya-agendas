import { supabaseAdmin } from "@/lib/supabaseAdmin";

type NotifyWaitlistSlotReleasedArgs = {
  tenantId: string | null;
  serviceId: string | null;
  startAt: string | null;
};

type WaitlistRequestRow = {
  id: string;
  customer_email: string | null;
  customer_name: string | null;
};

function getSlotParts(startAt: string) {
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;

  if (!day || !time) return null;
  return { date: day, time };
}

export async function notifyWaitlistSlotReleased(
  args: NotifyWaitlistSlotReleasedArgs,
): Promise<void> {
  try {
    if (!args.tenantId || !args.serviceId || !args.startAt) return;

    const slot = getSlotParts(args.startAt);
    if (!slot) return;

    const { data, error } = await supabaseAdmin
      .from("waitlist_requests")
      .select("id, customer_email, customer_name")
      .eq("tenant_id", args.tenantId)
      .eq("service_id", args.serviceId)
      .eq("date", slot.date)
      .eq("time", slot.time)
      .eq("status", "active");

    if (error) throw error;

    const requests = (data ?? []) as WaitlistRequestRow[];
    if (requests.length === 0) return;

    console.log("[waitlist] slot released", {
      tenantId: args.tenantId,
      serviceId: args.serviceId,
      date: slot.date,
      time: slot.time,
      requestCount: requests.length,
      requestIds: requests.map((request) => request.id),
    });

    const { error: updateError } = await supabaseAdmin
      .from("waitlist_requests")
      .update({ status: "notified" })
      .in(
        "id",
        requests.map((request) => request.id),
      );

    if (updateError) throw updateError;
  } catch (error) {
    console.error("[waitlist] failed to process released slot", {
      tenantId: args.tenantId,
      serviceId: args.serviceId,
      startAt: args.startAt,
      error,
    });
  }
}
