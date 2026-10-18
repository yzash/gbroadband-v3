import { PersonaHeader } from "@/components/persona/kit";
import { FieldClient } from "./FieldClient";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <PersonaHeader role="cfs_tech" stage="Act · Customer Facing Service · home visits only when needed" />
      <div className="min-h-0 flex-1 overflow-auto">
        <FieldClient />
      </div>
    </div>
  );
}
