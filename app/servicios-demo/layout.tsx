import { ReactNode } from "react";
import { DemoTopNav } from "./components/demo-top-nav";
import { WhatsAppFloatingButton } from "./components/whatsapp-floating-button";

export default function ServiciosDemoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      <DemoTopNav />
      {children}
      <WhatsAppFloatingButton />
    </div>
  );
}
