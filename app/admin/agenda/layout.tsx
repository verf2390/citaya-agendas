import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agenda Citas | Fajas Paola",
};

export default function AgendaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
