import { PageHeader } from "@/components/PageHeader";
import { ConfigurationsClient } from "./ConfigurationsClient";

export default function ConfigurationsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Configurations" stage="The SDAL framework · same loop, new configuration" />
      <div className="min-h-0 flex-1 overflow-auto">
        <ConfigurationsClient />
      </div>
    </div>
  );
}
