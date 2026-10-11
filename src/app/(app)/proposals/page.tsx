import { PageHeader } from "@/components/PageHeader";
import { ProposalsClient } from "./ProposalsClient";

export default function ProposalsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Approvals & Audit" stage="Act · human-in-the-loop" />
      <div className="min-h-0 flex-1 overflow-auto">
        <ProposalsClient />
      </div>
    </div>
  );
}
