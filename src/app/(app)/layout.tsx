import { LeftRail } from "@/components/LeftRail";
import { TopBar } from "@/components/TopBar";
import { Footer } from "@/components/Footer";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftRail />
        <main className="relative min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
      <Footer />
    </div>
  );
}
