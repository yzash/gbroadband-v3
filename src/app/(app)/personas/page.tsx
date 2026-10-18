import { PageHeader } from "@/components/PageHeader";
import { PersonasClient } from "./PersonasClient";

export default function PersonasPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Who runs on SDAL" stage="The SDAL framework · six teams · one live picture" />
      <div className="min-h-0 flex-1 overflow-auto">
        <PersonasClient />
      </div>
    </div>
  );
}
