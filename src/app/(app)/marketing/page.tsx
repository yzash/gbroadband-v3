import { PersonaHeader } from "@/components/persona/kit";
import { MarketingClient } from "./MarketingClient";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <PersonaHeader role="marketing" stage="Act → Learn · Brand & Marketing · acquisition, base, comms" />
      <div className="min-h-0 flex-1 overflow-auto">
        <MarketingClient />
      </div>
    </div>
  );
}
