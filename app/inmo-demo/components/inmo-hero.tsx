import type { ReactNode } from "react";

type InmoHeroProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  editorialNote?: string;
  videoSrc?: string;
  poster?: string;
  children?: ReactNode;
  heightClassName?: string;
};

export function InmoHero({
  eyebrow,
  title,
  subtitle,
  editorialNote,
  videoSrc = "/inmo-demo/hero/17224730-hd_1920_1080_30fps.mp4",
  poster = "/inmo-demo/properties/pexels-griffinw-6643264.jpg",
  children,
  heightClassName = "min-h-[88vh]",
}: InmoHeroProps) {
  return (
    <section className={`relative isolate flex items-end overflow-hidden px-4 pb-16 pt-36 sm:px-8 lg:px-16 ${heightClassName}`}>
      <video autoPlay muted loop playsInline preload="auto" poster={poster} className="animate-hero-zoom absolute inset-0 -z-30 h-full w-full object-cover">
        <source src={videoSrc} type="video/mp4" />
      </video>

      <div className="absolute inset-0 -z-20 bg-black/55" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(110deg,rgba(0,0,0,.75)_5%,rgba(0,0,0,.35)_55%,rgba(0,0,0,.05)_100%)]" />

      <div className="mx-auto w-full max-w-7xl animate-fade-in-up">
        <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-200">{eyebrow}</p>
        <h1 className="mt-5 max-w-5xl text-4xl font-semibold leading-[1.08] text-white sm:text-6xl lg:text-7xl">{title}</h1>
        {editorialNote ? (
          <div className="mt-6 flex items-center gap-3">
            <span aria-hidden="true" className="h-px w-16 bg-white/45" />
            <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-100/90">{editorialNote}</p>
          </div>
        ) : null}
        <p className="mt-7 max-w-2xl text-sm leading-7 text-zinc-200 sm:text-base">{subtitle}</p>
        {children ? <div className="mt-10">{children}</div> : null}
      </div>
    </section>
  );
}
