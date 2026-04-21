type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  centered?: boolean;
};

export function SectionHeading({ eyebrow, title, description, centered = false }: SectionHeadingProps) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">{eyebrow}</p>
      ) : null}
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{title}</h2>
      {description ? <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">{description}</p> : null}
    </div>
  );
}
