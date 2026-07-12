import { PageHeader } from "@/components/PageHeader";
import { ConfigurationsClient } from "./ConfigurationsClient";

export default function ConfigurationsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Configurations" stage="Registry · same loop, configuration only" />
      <div className="min-h-0 flex-1 overflow-auto">
        <ConfigurationsClient />
      </div>
    </div>
  );
}
