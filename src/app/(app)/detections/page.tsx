import { PageHeader } from "@/components/PageHeader";
import { DetectionsClient } from "./DetectionsClient";

export default function DetectionsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Detections" stage="Sense → Decide handoff">
        <span className="text-2xs text-ink-3">
          fused telemetry + <span className="text-record">ticket-cluster inference</span> · confidence hardens live
        </span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        <DetectionsClient />
      </div>
    </div>
  );
}
