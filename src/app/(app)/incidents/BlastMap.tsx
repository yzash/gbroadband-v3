"use client";

import { useMemo } from "react";
import { useApp } from "@/components/AppState";
import { NetworkMap } from "@/components/map/NetworkMap";
import { useGeo, locate } from "@/lib/geo-client";
import { BRAND } from "@/lib/brand";

const OVERLAYS = { backbone: true, incidents: true, crews: true, heat: false };

/** The incident's blast radius on real geography: who called vs who's silent. */
export function BlastMap({
  incidentId,
  observed,
  inferred,
  suspect,
}: {
  incidentId: string;
  observed: string[];
  inferred: string[];
  suspect: string | null;
}) {
  const { snapshot } = useApp();
  const bundle = useGeo(snapshot?.sensing_health.coverage);

  const focus = useMemo(() => ({ observed, inferred, suspect }), [observed, inferred, suspect]);
  const fit = useMemo(() => {
    if (!bundle) return null;
    const pts = [...observed, ...inferred, ...(suspect ? [suspect] : [])].map((id) => locate(bundle, id)).filter(Boolean) as [number, number][];
    if (!pts.length) return null;
    let [w, s, e, n] = [180, 90, -180, -90];
    for (const [x, y] of pts) {
      w = Math.min(w, x);
      s = Math.min(s, y);
      e = Math.max(e, x);
      n = Math.max(n, y);
    }
    const pad = 0.003;
    return { key: `${incidentId}-${pts.length}`, bounds: [w - pad, s - pad, e + pad, n + pad] as [number, number, number, number] };
  }, [bundle, observed, inferred, suspect, incidentId]);

  return (
    <div className="relative h-[260px] overflow-hidden rounded-md border border-line bg-[#040918]">
      {snapshot && bundle ? (
        <NetworkMap
          key={incidentId}
          snapshot={snapshot}
          bundle={bundle}
          layer="health"
          overlays={OVERLAYS}
          selected={{ kind: "incident", id: incidentId }}
          focus={focus}
          fit={fit}
          padding={{ top: 28, right: 28, bottom: 28, left: 28 }}
          compact
        />
      ) : (
        <div className="grid h-full place-items-center text-xs text-ink-3">Loading map…</div>
      )}
      <div className="pointer-events-none absolute left-2 top-2 flex gap-2 rounded-md bg-[#040918]/85 px-2 py-1 text-[10.5px] text-ink-2 backdrop-blur">
        <span className="flex items-center gap-1">
          <i className="h-2 w-2 rounded-full" style={{ background: BRAND.critical }} /> called / seen
        </span>
        <span className="flex items-center gap-1">
          <i className="h-2 w-2 rounded-full border-[1.5px]" style={{ borderColor: BRAND.watch }} /> silent
        </span>
        <span className="flex items-center gap-1">
          <i className="h-2 w-2 rounded-full border-[1.5px]" style={{ borderColor: BRAND.globeSky }} /> suspect
        </span>
      </div>
    </div>
  );
}
