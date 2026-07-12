import { PageHeader } from "@/components/PageHeader";
import { OperationsClient } from "./OperationsClient";

export default function OperationsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Operations" stage="NOC command · Sense" />
      <div className="min-h-0 flex-1 overflow-hidden">
        <OperationsClient />
      </div>
    </div>
  );
}
