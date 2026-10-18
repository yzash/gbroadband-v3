import { PersonaHeader } from "@/components/persona/kit";
import { SalesClient } from "./SalesClient";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <PersonaHeader role="sales_force" stage="Act · Sales Force · accounts first, sell where it's healthy" />
      <div className="min-h-0 flex-1 overflow-auto">
        <SalesClient />
      </div>
    </div>
  );
}
