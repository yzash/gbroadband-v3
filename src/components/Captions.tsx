"use client";

import { usePathname } from "next/navigation";
import { useApp } from "./AppState";
import { useLive } from "./persona/kit";
import { pesoCompact } from "@/lib/tokens";
import type { Outcomes } from "@/lib/persona-queries";
import type { OpsSnapshot } from "@/lib/types";

/**
 * Presenter captions for recording the demo: a keyword for emphasis and the
 * outcome it proves, computed from the live simulation. Toggle with the CC
 * button in the top bar or ?captions=1.
 */
interface Caption {
  kicker: string;
  keyword: string;
  facts: string[];
}

const n = (v: number) => v.toLocaleString();
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export function captionFor(path: string, o: Outcomes, s: OpsSnapshot | null): Caption {
  const holdCities = s ? Object.values(s.city_stats).filter((c) => c.sell === "hold").length : 0;
  const lift = o.marketing.retentionLift;
  const liftTxt = lift == null ? "lift measuring" : `+${Math.round(lift * 100)}% retention lift vs holdout`;
  const rightFirst = o.noc.correctRolls + o.noc.wrongRolls ? `${pct(1 - o.noc.wrongRollRate)} of trucks right first time` : "trucks sent to the exact element";

  if (path.startsWith("/operations"))
    return {
      kicker: "Sense · one live picture",
      keyword: "Single pane of glass",
      facts: [`${n(o.network.lines)} lines`, `${n(o.network.impacted)} customers down`, `${n(o.network.silent)} haven't called`, `${pesoCompact(o.network.pesoAtRisk)}/mo at risk`],
    };
  if (path.startsWith("/detections"))
    return {
      kicker: "Sense · found in the dark",
      keyword: "Detect before they call",
      facts: [`only ${pct(o.network.sensedPct)} of lines actively sensed`, "outages still caught from tickets + dying-gasp"],
    };
  if (path.startsWith("/incidents"))
    return {
      kicker: "Decide · NOC Lead",
      keyword: "Right truck, right place, first time",
      facts: [rightFirst, `${n(o.noc.rollsAvoided)} wasted truck rolls avoided`, `${n(o.network.silent)} silent customers found`],
    };
  if (path.startsWith("/proposals"))
    return { kicker: "Act · human in the loop", keyword: "Every action owned and audited", facts: ["each team approves only its own decisions", "full audit trail"] };
  if (path.startsWith("/care"))
    return {
      kicker: "Act · Customer Service",
      keyword: "They already know",
      facts: [`${n(o.care.informedBeforeCall)} customers told before they called`, `${n(o.care.callsDeflected)} calls deflected`, `${pct(o.care.knownCausePct)} of callers answered on screen`],
    };
  if (path.startsWith("/sales"))
    return {
      kicker: "Act · Sales Force",
      keyword: "Your accounts hear it from you first",
      facts: [`${n(o.sales.briefedBeforeCall)} business accounts briefed before they called`, `${holdCities} cities on hold for selling`],
    };
  if (path.startsWith("/field"))
    return {
      kicker: "Act · CFS home visits",
      keyword: "No wasted home visits",
      facts: [`${n(o.cfs.visitsAvoided)} home visits avoided`, `${n(o.cfs.remoteFixes)} fixed remotely`, `${pct(o.cfs.firstVisitFixPct)} fixed on first visit`],
    };
  if (path.startsWith("/partners"))
    return {
      kicker: "Learn · last-mile partners",
      keyword: "The feedback loop from the field",
      facts: [`${n(o.partner.closeouts)} close-outs`, `${n(o.partner.recordErrorsReported)} record errors reported`, `${n(o.partner.correctionsAccepted)} records corrected`, `${pct(o.partner.firstTimeFixPct)} right first time`],
    };
  if (path.startsWith("/marketing"))
    return {
      kicker: "Act → Learn · Brand & Marketing",
      keyword: "Protect the spend. Keep the customer.",
      facts: [liftTxt, `campaigns paused in ${o.marketing.holdsActive} ${o.marketing.holdsActive === 1 ? "city" : "cities"} with outages`, `${n(o.marketing.offersSent)} retention offers`],
    };
  if (path.startsWith("/learn"))
    return {
      kicker: "Learn · it compounds",
      keyword: "Every outage makes the next one shorter",
      facts: [liftTxt, `${n(o.care.callsDeflected)} calls deflected`, `${n(o.partner.correctionsAccepted)} records corrected`],
    };
  if (path.startsWith("/personas"))
    return {
      kicker: "The SDAL framework",
      keyword: "Six teams. One framework. One live picture.",
      facts: ["NOC", "Customer Service", "Sales Force", "CFS", "Last-mile partners", "Brand & Marketing"],
    };
  if (path.startsWith("/ask")) return { kicker: "Assist", keyword: "Ask the network", facts: ["answers from live data", "drafts actions — humans approve"] };
  if (path.startsWith("/configurations"))
    return { kicker: "The SDAL framework", keyword: "Same framework, next outcome", facts: ["Retention & Care today", "acquisition, capacity, workforce next"] };
  return { kicker: "SDAL framework", keyword: "Sense · Decide · Act · Learn", facts: [] };
}

export function Captions() {
  const { captions, snapshot } = useApp();
  const path = usePathname();
  const [o] = useLive<Outcomes>(captions ? "/api/outcomes" : null); // only polls while captions are on
  if (!captions || !o) return null;
  const c = captionFor(path, o, snapshot);
  return (
    <div className="flex shrink-0 items-center gap-6 border-t-2 border-globe-sky/60 bg-[#040918] px-8 py-3" data-testid="captions" aria-live="polite">
      <div className="min-w-0 shrink-0">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-globe-sky">{c.kicker}</div>
        <div className="font-display text-[26px] font-extrabold leading-tight tracking-tight text-white">{c.keyword}</div>
      </div>
      <div className="h-10 w-px shrink-0 bg-line-2" />
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
        {c.facts.map((f, i) => (
          <span key={i} className="text-[17px] font-semibold text-ink">
            {i > 0 && <span className="mr-5 text-globe-sky">·</span>}
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}
