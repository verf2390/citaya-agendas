import type { ReactNode } from "react";

type InmoHeroProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  videoSrc?: string;
  poster?: string;
  children?: ReactNode;
  heightClassName?: string;
};

export function InmoHero({
  eyebrow,
  title,
  subtitle,
  videoSrc = "/inmo-demo/hero/17224730-hd_1920_1080_30fps.mp4",
  poster = "/inmo-demo/properties/pexels-griffinw-6643264.jpg",
  children,
  heightClassName = "min-h-[85vh]",
}: InmoHeroProps) {
  return (
    <section className={`relative isolate flex items-end overflow-hidden px-4 pb-16 pt-28 sm:px-8 lg:px-16 ${heightClassName}`}>
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster={poster}
        className="absolute inset-0 -z-30 h-full w-full object-cover"
      >
        <source src={videoSrc} type="video/mp4" />
      </video>

      <div className="absolute inset-0 -z-20 bg-black/40" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/60 via-black/35 to-transparent" />

      <div className="mx-auto w-full max-w-7xl animate-fade-in-up">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-100">{eyebrow}</p>
        <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight text-white sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-200 sm:text-lg">{subtitle}</p>
        {children ? <div className="mt-8">{children}</div> : null}
      </div>
    </section>
  );
}
