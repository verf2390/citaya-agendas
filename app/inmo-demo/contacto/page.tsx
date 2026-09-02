import Link from "next/link";
import { InmoHero } from "../components/inmo-hero";

export default function ContactoPage() {
  return (
    <main className="bg-[#f4f4f2]">
      <InmoHero eyebrow="Concierge inmobiliario" title="Convierte tu catálogo inmobiliario en una experiencia premium" subtitle="Te mostramos cómo una web así puede presentar tus propiedades, ordenar tus contactos y elevar la percepción de tu marca." poster="/inmo-demo/properties/pexels-artbovich-8141956.jpg" heightClassName="min-h-[68vh]">
        <div className="flex flex-col gap-3 sm:flex-row"><Link href="/inmo-demo/propiedades" className="btn-inmo-secondary border-white/45 bg-white/10 text-white">Ver propiedades</Link><a href="https://wa.me/56961425029" target="_blank" rel="noreferrer" className="btn-inmo-primary border-white/20 bg-white text-neutral-950 hover:bg-zinc-200">Hablar con asesor</a></div>
      </InmoHero>

      <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.55)] sm:p-10">
          <form className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.14em] text-neutral-500">Nombre<input type="text" className="h-12 rounded-xl border border-neutral-300 px-3 text-sm" placeholder="Tu nombre" /></label>
            <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.14em] text-neutral-500">Email<input type="email" className="h-12 rounded-xl border border-neutral-300 px-3 text-sm" placeholder="tu@email.com" /></label>
            <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.14em] text-neutral-500 sm:col-span-2">Objetivo inmobiliario<textarea className="min-h-28 rounded-xl border border-neutral-300 p-3 text-sm" placeholder="Ej: vender departamento en Las Condes en 90 días." /></label>
            <div className="sm:col-span-2"><button type="button" className="btn-inmo-primary w-full justify-center">Solicitar asesoría privada</button></div>
          </form>
        </div>
      </section>
    </main>
  );
}
