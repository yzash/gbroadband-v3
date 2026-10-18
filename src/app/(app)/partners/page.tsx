import { PersonaHeader } from "@/components/persona/kit";
import { PartnersClient } from "./PartnersClient";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <PersonaHeader role="partner" stage="Act → Learn · last-mile partners · the field feedback loop" />
      <div className="min-h-0 flex-1 overflow-auto">
        <PartnersClient />
      </div>
    </div>
  );
}
