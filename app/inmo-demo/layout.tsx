import type { ReactNode } from "react";

import { InmoNavbar } from "./components/inmo-navbar";

export default function InmoDemoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <InmoNavbar />
      {children}
    </div>
  );
}
