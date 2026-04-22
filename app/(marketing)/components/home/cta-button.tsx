import Link from "next/link";
import type { ReactNode } from "react";

type CtaVariant = "primary" | "secondary" | "ghost" | "whatsapp";

type CtaButtonProps = {
  href: string;
  children: ReactNode;
  variant: CtaVariant;
  className?: string;
  target?: "_blank" | "_self" | "_parent" | "_top";
  rel?: string;
  showArrow?: boolean;
};

const baseClasses =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98]";

const variantClasses: Record<CtaVariant, string> = {
  primary:
    "bg-cyan-500 text-white shadow-lg shadow-cyan-500/30 hover:-translate-y-0.5 hover:scale-[1.03] hover:bg-cyan-600 hover:shadow-cyan-500/50 focus-visible:ring-cyan-300",
  secondary:
    "border border-slate-200 bg-white text-slate-900 shadow-sm hover:-translate-y-0.5 hover:bg-slate-50 hover:border-slate-300 hover:shadow-md focus-visible:ring-slate-200",
  ghost:
    "bg-transparent text-slate-600 shadow-none hover:text-slate-900 hover:underline focus-visible:ring-slate-200",
  whatsapp:
    "bg-green-500 text-white shadow-lg shadow-green-500/30 hover:-translate-y-0.5 hover:scale-[1.03] hover:bg-green-600 hover:shadow-green-500/50 focus-visible:ring-green-300",
};

export function CtaButton({
  href,
  children,
  variant,
  className = "",
  target,
  rel,
  showArrow = false,
}: CtaButtonProps) {
  return (
    <Link href={href} target={target} rel={rel} className={`${baseClasses} ${variantClasses[variant]} ${className}`}>
      <span>{children}</span>
      {showArrow ? <span aria-hidden>→</span> : null}
    </Link>
  );
}
