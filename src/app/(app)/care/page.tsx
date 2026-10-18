import { PersonaHeader } from "@/components/persona/kit";
import { CareClient } from "./CareClient";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <PersonaHeader role="customer_service" stage="Act · Customer Service · the caller already has an answer" />
      <div className="min-h-0 flex-1 overflow-auto">
        <CareClient />
      </div>
    </div>
  );
}
