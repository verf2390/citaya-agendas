"use client";

import { useState } from "react";
import {
  professionalAvatarState,
  trustedProfessionalAvatarUrl,
} from "@/lib/media/professional-avatar.mjs";

type ProfessionalAvatarProps = {
  name: string;
  url?: string | null;
  className?: string;
};

export function ProfessionalAvatar({
  name,
  url,
  className = "",
}: ProfessionalAvatarProps) {
  const origin = typeof window === "undefined" ? undefined : window.location.origin;
  const trustedUrl = trustedProfessionalAvatarUrl(url, origin);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const state = professionalAvatarState({
    url: trustedUrl,
    failed: Boolean(trustedUrl && failedUrl === trustedUrl),
    name,
    origin,
  });

  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(180deg,#ffffff_0%,#e2e8f0_100%)] ring-1 ring-slate-200 shadow-[0_8px_18px_rgba(15,23,42,0.08)] ${className}`}
      aria-label={`Fotografía de ${name}`}
    >
      {state.showImage && state.src ? (
        <>
          {/* Avatar remoto validado en runtime; Image no admite hosts Supabase dinámicos. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.src}
            alt=""
            width={48}
            height={48}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={() => setFailedUrl(state.src)}
          />
        </>
      ) : (
        <span aria-hidden="true" className="text-sm font-extrabold text-slate-700">
          {state.initials}
        </span>
      )}
    </div>
  );
}
