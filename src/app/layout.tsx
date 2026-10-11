import type { Metadata } from "next";
import "./globals.css";
import { AppStateProvider } from "@/components/AppState";

export const metadata: Metadata = {
  title: "Globe Network Assurance · SDAL",
  description: "Sense → Decide → Act → Learn — fault inference & localization across Metro Manila, under imperfect data.",
  icons: { icon: "/favicon.svg" },
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
