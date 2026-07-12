import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { IncidentRoomClient } from "./IncidentRoomClient";

export default function IncidentsPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Incident Room" stage="Decide + Act" />
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="grid h-full place-items-center text-ink-3">Loading…</div>}>
          <IncidentRoomClient />
        </Suspense>
      </div>
    </div>
  );
}
