"use client";

import * as React from "react";
import { useToast } from "@/components/ui/use-toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="fixed top-4 right-4 z-[9999] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            "rounded-xl border bg-background p-4 shadow-lg",
            t.variant === "destructive"
              ? "border-destructive/40"
              : "border-border",
          ].join(" ")}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {t.title ? (
                <div className="text-sm font-semibold leading-5">{t.title}</div>
              ) : null}
              {t.description ? (
                <div className="mt-1 text-sm text-muted-foreground">
                  {t.description}
                </div>
              ) : null}
              {t.action ? <div className="mt-2">{t.action}</div> : null}
            </div>

            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
              aria-label="Cerrar"
              title="Cerrar"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
