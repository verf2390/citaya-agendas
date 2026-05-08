import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agenda Citas | Citaya",
};

export default function AgendaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
