"use client";

import * as React from "react";

type Variant = "brand" | "danger" | "slate";

type ShimmerButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  shimmerColor?: string;
  variant?: Variant;
};

function cx(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(" ");
}

const VARIANTS: Record<Variant, string> = {
  brand: "bg-gradient-to-r from-orange-500 to-amber-500 text-white",
  danger: "bg-gradient-to-r from-red-600 to-rose-600 text-white",
  slate: "bg-gradient-to-r from-slate-900 to-slate-700 text-white",
};

export default function ShimmerButton({
  className,
  children,
  shimmerColor = "rgba(255,255,255,0.35)",
  variant = "brand",
  disabled,
  ...props
}: ShimmerButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={cx(
        "relative inline-flex h-11 items-center justify-center overflow-hidden rounded-xl px-6 font-semibold transition",
        VARIANTS[variant],
        "hover:scale-[1.02] active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400",
        disabled && "opacity-60 cursor-not-allowed hover:scale-100 active:scale-100",
        className
      )}
    >
      {/* shimmer layer (se apaga si disabled) */}
      {!disabled ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2.5s_infinite]"
          style={{
            background: `linear-gradient(120deg, transparent, ${shimmerColor}, transparent)`,
          }}
        />
      ) : null}

      <span className="relative z-10">{children}</span>

      <style jsx>{`
        @keyframes shimmer {
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </button>
  );
}
