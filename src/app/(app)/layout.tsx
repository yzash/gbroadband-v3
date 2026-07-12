import { LeftRail } from "@/components/LeftRail";
import { ClockHeader } from "@/components/ClockHeader";
import { Footer } from "@/components/Footer";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <LeftRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <ClockHeader />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        <Footer />
      </div>
    </div>
  );
}
