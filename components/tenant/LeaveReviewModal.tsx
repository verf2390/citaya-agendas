"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type Props = {
  tenantId: string;
  businessName?: string;
};

function clampStr(s: string, max: number) {
  const v = (s ?? "").trim();
  return v.length > max ? v.slice(0, max) : v;
}

export default function LeaveReviewModal({ tenantId, businessName }: Props) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const title = useMemo(
    () => `Dejar reseña${businessName ? ` · ${businessName}` : ""}`,
    [businessName],
  );

  const reset = () => {
    setName("");
    setRating(5);
    setComment("");
    setErr(null);
    setOk(false);
  };

  const close = () => {
    setOpen(false);
    // deja el reset suave para no “parpadear” al cerrar
    setTimeout(reset, 150);
  };

  const canSubmit =
    name.trim().length >= 2 &&
    comment.trim().length >= 5 &&
    rating >= 1 &&
    rating <= 5 &&
    !submitting;

  const submit = async () => {
    setErr(null);
    setOk(false);

    const safeName = clampStr(name, 40);
    const safeComment = clampStr(comment, 400);

    if (safeName.length < 2) {
      setErr("Tu nombre debe tener al menos 2 caracteres.");
      return;
    }
    if (safeComment.length < 5) {
      setErr("Tu comentario debe tener al menos 5 caracteres.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from("tenant_reviews").insert({
        tenant_id: tenantId,
        customer_name: safeName,
        rating,
        comment: safeComment,
        is_hidden: false, // si luego moderas, lo cambiamos a true por defecto
      });

      if (error) {
        console.error("insert review error:", error);
        setErr("No se pudo guardar tu reseña. Intenta nuevamente.");
        return;
      }

      setOk(true);

      // refresca server component (promedio/conteo) sin tocar lógica core
      router.refresh();

      // cierra automático luego de un momento
      setTimeout(() => close(), 900);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-50 active:scale-[0.99]"
      >
        Dejar reseña
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* overlay */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={close}
          />

          {/* modal */}
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg rounded-t-3xl border border-slate-200 bg-white p-5 shadow-xl sm:inset-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-extrabold text-slate-900">
                  Dejar reseña
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Tu opinión ayuda a otros clientes.
                </div>
              </div>

              <button
                type="button"
                onClick={close}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 grid gap-3">
              {/* Nombre */}
              <div>
                <label className="text-xs font-semibold text-slate-600">
                  Tu nombre
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Camila"
                  maxLength={40}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </div>

              {/* Rating */}
              <div>
                <label className="text-xs font-semibold text-slate-600">
                  Valoración
                </label>
                <div className="mt-2 flex items-center gap-2">
                  {Array.from({ length: 5 }).map((_, i) => {
                    const v = i + 1;
                    const active = v <= rating;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setRating(v)}
                        className={[
                          "h-10 w-10 rounded-2xl border text-lg leading-none",
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50",
                        ].join(" ")}
                        aria-label={`${v} estrellas`}
                      >
                        ★
                      </button>
                    );
                  })}
                  <div className="text-sm font-bold text-slate-900">
                    {rating}/5
                  </div>
                </div>
              </div>

              {/* Comentario */}
              <div>
                <label className="text-xs font-semibold text-slate-600">
                  Comentario
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Cuéntanos cómo fue tu experiencia..."
                  maxLength={400}
                  rows={4}
                  className="mt-1 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  {comment.trim().length}/400
                </div>
              </div>

              {/* Error / OK */}
              {err ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {err}
                </div>
              ) : null}

              {ok ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  ¡Gracias! Tu reseña fue enviada ✅
                </div>
              ) : null}

              {/* CTA */}
              <div className="mt-1 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-50"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={submit}
                  className={[
                    "rounded-2xl px-4 py-3 text-sm font-extrabold text-white",
                    canSubmit
                      ? "bg-slate-900 hover:opacity-90 active:scale-[0.99]"
                      : "bg-slate-300 cursor-not-allowed",
                  ].join(" ")}
                >
                  {submitting ? "Enviando..." : "Enviar reseña"}
                </button>
              </div>

              <div className="text-[11px] text-slate-500">
                * Evita datos sensibles (RUT, direcciones, etc).
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}