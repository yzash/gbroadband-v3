import type { Metadata } from "next";
import "./globals.css";
import { AppStateProvider } from "@/components/AppState";

export const metadata: Metadata = {
  title: "SDAL · Broadband Intelligence",
  description: "Sense → Decide → Act → Learn — fault inference & localization under imperfect data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-base font-sans text-ink antialiased">
        <AppStateProvider>{children}</AppStateProvider>
      </body>
    </html>
  );
}
