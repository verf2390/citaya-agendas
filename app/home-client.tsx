"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Phone, Star, ShieldCheck, Sparkles } from "lucide-react";
import WeeklyAvailabilityCalendar from "@/components/admin/availability/WeeklyAvailabilityCalendar";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
};

type Appointment = {
  id: string;
  tenant_id: string;
  professional_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  start_at: string;
  end_at: string;
  status: string;
  notes: string | null;
  created_at: string;
};

type TenantReview = {
  id: string;
  tenant_id: string;
  customer_name: string;
  rating: number;
  comment: string;
  is_hidden: boolean;
  created_at: string;
};

// ⚠️ Mantengo tu tenant fijo para no romper nada hoy
const TENANT_ID = "04d6c088-338d-44b2-b27b-b4709f48d31b";
const TENANT_SLUG = "fajaspaola";

// Debug visible solo si seteas esta env var
const SHOW_DEBUG =
  String(process.env.NEXT_PUBLIC_SHOW_DEBUG_HOME ?? "").toLowerCase() ===
  "true";

export default function HomeClient() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);

  const [reviews, setReviews] = useState<TenantReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);

  // Marca blanca (customizable luego por tenant)
  const business = useMemo(
    () => ({
      name: "Fajas Paola",
      tagline: "Reserva tu hora en segundos",
      description:
        "Elige tu día y horario disponible. Recibirás confirmación y podrás gestionar tu cita desde un enlace privado.",
      phoneDisplay: "+56 9 0000 0000",
      // Puedes cambiarlo a link WhatsApp más adelante (Pro)
      phoneHref: "tel:+56900000000",
      addressLine: "Santiago, Chile",
    }),
    [],
  );

  // ✅ Cargar reseñas reales
  useEffect(() => {
    const loadReviews = async () => {
      setReviewsLoading(true);

      const { data, error } = await supabase
        .from("tenant_reviews")
        .select(
          "id, tenant_id, customer_name, rating, comment, created_at, is_hidden",
        )
        .eq("tenant_id", TENANT_ID)
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(6);

      if (error) {
        console.error("reviewsError:", error);
        setReviews([]);
      } else {
        setReviews((data ?? []) as TenantReview[]);
      }

      setReviewsLoading(false);
    };

    loadReviews();
  }, []);

  // ✅ Debug opcional
  useEffect(() => {
    if (!SHOW_DEBUG) return;

    const load = async () => {
      setLoading(true);

      const { data: tenantsData, error: tenantsError } = await supabase
        .from("tenants")
        .select("*")
        .order("created_at", { ascending: true });

      if (tenantsError) console.error("tenantsError:", tenantsError);
      setTenants(tenantsData ?? []);

      const { data: apptData, error: apptError } = await supabase
        .from("appointments")
        .select("*")
        .eq("tenant_id", TENANT_ID)
        .order("start_at", { ascending: true });

      if (apptError) console.error("apptError:", apptError);
      setAppointments(apptData ?? []);

      setLoading(false);
    };

    load();
  }, []);

  return (
    <main className="min-h-screen bg-slate-50">
      <div style={{ padding: 12, background: "yellow", fontWeight: 800 }}>
        DEBUG HOME NUEVA ✅ (si ves esto, es este repo)
      </div>

      {/* Fondo suave */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-28 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-slate-200/60 via-slate-100/30 to-slate-200/60 blur-3xl" />
        <div className="absolute -bottom-28 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-100/35 via-slate-100/20 to-emerald-100/25 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-[980px] px-4 pb-16 pt-8 sm:pt-12">
        {/* Card principal */}
        <section className="rounded-3xl border border-slate-200 bg-white/85 shadow-sm backdrop-blur">
          <div className="p-6 sm:p-10">
            {/* Header */}
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                  <Sparkles className="h-4 w-4" />
                  Reserva online
                </div>

                <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                  {business.name}
                </h1>

                <p className="mt-2 text-base font-semibold text-slate-700">
                  {business.tagline}
                </p>

                <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600">
                  {business.description}
                </p>

                <div className="mt-4 flex flex-col gap-2 text-sm text-slate-700 sm:flex-row sm:items-center sm:gap-4">
                  <a
                    href={business.phoneHref}
                    className="inline-flex w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold hover:bg-slate-50"
                  >
                    <Phone className="h-4 w-4" />
                    {business.phoneDisplay}
                  </a>

                  <div className="text-xs text-slate-500">
                    {business.addressLine}
                  </div>
                </div>

                {/* ✅ CTA grande arriba */}
                <div className="mt-6">
                  <Link
                    href="/reservar"
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-4 text-base font-extrabold text-white shadow-sm hover:opacity-90 active:scale-[0.99] sm:w-auto"
                  >
                    Reserva ahora
                  </Link>

                  <p className="mt-2 text-xs text-slate-500">
                    Confirmación inmediata · enlace privado para
                    modificar/cancelar
                  </p>
                </div>
              </div>

              {/* Banner/imagen simple (placeholder elegante) */}
              <div className="w-full sm:w-[360px]">
                <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-100 to-white">
                  <div className="p-5">
                    <div className="text-xs font-semibold text-slate-600">
                      Atención personalizada
                    </div>
                    <div className="mt-2 text-sm text-slate-700">
                      Agenda tu hora sin llamadas y con horarios reales
                      disponibles.
                    </div>

                    <div className="mt-5 grid gap-2">
                      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-700" />
                        <div>
                          <div className="text-sm font-bold text-slate-900">
                            Gestión sin login
                          </div>
                          <div className="text-xs text-slate-600">
                            Cambia o cancela desde un enlace privado.
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <Star className="mt-0.5 h-4 w-4 text-slate-700" />
                        <div>
                          <div className="text-sm font-bold text-slate-900">
                            Experiencia rápida
                          </div>
                          <div className="text-xs text-slate-600">
                            En menos de 1 minuto dejas tu hora lista.
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ⚠️ Por ahora mantenemos este “rating” como visual.
                        En el paso del modal lo hacemos real (promedio). */}
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="text-xs font-semibold text-slate-600">
                        Valoración
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="flex items-center">
                          {[...Array(5)].map((_, i) => (
                            <Star
                              key={i}
                              className="h-4 w-4 fill-slate-900 text-slate-900"
                            />
                          ))}
                        </div>
                        <div className="text-xs font-semibold text-slate-700">
                          5.0
                        </div>
                        <div className="text-xs text-slate-500">
                          (
                          {reviewsLoading
                            ? "Cargando..."
                            : `${reviews.length} reseña${reviews.length === 1 ? "" : "s"}`}
                          )
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 text-[11px] text-slate-500">
                      * La sección “Reseñas” ya es real. El promedio lo dejamos
                      para el siguiente paso.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ✅ Reseñas reales */}
            <div className="mt-10">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    Reseñas
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Opiniones reales de clientes.
                  </p>
                </div>
              </div>

              {reviewsLoading ? (
                <div className="mt-4 text-sm text-slate-600">
                  Cargando reseñas...
                </div>
              ) : reviews.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  Aún no hay reseñas. Sé la primera persona en dejar una 👇
                </div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {reviews.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-extrabold text-white">
                            {r.customer_name?.slice(0, 1)?.toUpperCase() ?? "C"}
                          </div>

                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-slate-900">
                              {r.customer_name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {new Date(r.created_at).toLocaleDateString()}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5">
                          {[...Array(5)].map((_, i) => (
                            <Star
                              key={i}
                              className={[
                                "h-4 w-4",
                                i < (r.rating ?? 0)
                                  ? "fill-slate-900 text-slate-900"
                                  : "text-slate-300",
                              ].join(" ")}
                            />
                          ))}
                        </div>
                      </div>

                      <p className="mt-3 text-sm text-slate-700">
                        “{r.comment}”
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* DEBUG opcional */}
        {SHOW_DEBUG ? (
          <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-900">Debug</h2>
              <div className="text-xs text-slate-500">
                NEXT_PUBLIC_SHOW_DEBUG_HOME=true
              </div>
            </div>

            {loading ? <p className="mt-3 text-sm">Cargando...</p> : null}

            {!loading ? (
              <>
                <div className="mt-4">
                  <div className="text-sm font-bold text-slate-900">
                    Tenants encontrados
                  </div>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-2xl bg-slate-50 p-4 text-xs text-slate-700">
                    {JSON.stringify(tenants, null, 2)}
                  </pre>
                </div>

                <div className="mt-4">
                  <div className="text-sm font-bold text-slate-900">
                    Citas (appointments) del tenant
                  </div>

                  {appointments.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-600">
                      No hay citas aún para este tenant.
                    </p>
                  ) : (
                    <ul className="mt-2 grid gap-2">
                      {appointments.map((a) => (
                        <li
                          key={a.id}
                          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
                        >
                          <div className="font-bold text-slate-900">
                            {a.customer_name}
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            ({a.status}) —{" "}
                            {new Date(a.start_at).toLocaleString()} →{" "}
                            {new Date(a.end_at).toLocaleString()}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
