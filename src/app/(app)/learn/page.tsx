import { PageHeader } from "@/components/PageHeader";
import { LearnClient } from "./LearnClient";

export default function LearnPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Learn" stage="Learn · lift · deflection · corrections · retrain" />
      <div className="min-h-0 flex-1 overflow-auto">
        <LearnClient />
      </div>
    </div>
  );
}
