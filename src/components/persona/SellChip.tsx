import type { CityStat } from "@/lib/types";

const STYLE: Record<CityStat["sell"], { cls: string; label: string }> = {
  sell: { cls: "bg-healthy/15 text-healthy", label: "Sell" },
  care: { cls: "bg-watch/15 text-watch", label: "Sell with care" },
  hold: { cls: "bg-critical/15 text-critical", label: "Hold" },
};

export function SellChip({ v, held }: { v: CityStat["sell"]; held?: boolean }) {
  const s = STYLE[v];
  return <span className={`chip shrink-0 ${s.cls}`}>{held ? "Campaign paused" : s.label}</span>;
}
