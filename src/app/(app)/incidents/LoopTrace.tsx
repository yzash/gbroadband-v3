"use client";

import { fmtSimTime } from "@/lib/tokens";

interface Detail {
  events: { sim_ts: number; kind: string; text: string; source: string }[];
}

/** Loop Trace — early version (M4): the detection/isolation timeline.
 *  Enriched with decisions, crew states, verification and record corrections in M7. */
export function LoopTrace({ detail }: { detail: Detail }) {
  return (
    <section className="card p-4">
      <h3 className="section-title mb-2">Loop Trace · Sense → Decide → Act → Learn</h3>
      {detail.events.length === 0 ? (
        <p className="text-xs text-ink-3">Trace builds as the incident progresses.</p>
      ) : (
        <ol className="relative ml-2 border-l border-line">
          {detail.events.map((e, i) => (
            <li key={i} className="mb-2 ml-4">
              <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-base bg-doctrine" />
              <div className="flex items-center gap-2">
                <span className="font-mono text-2xs text-ink-3">{fmtSimTime(e.sim_ts)}</span>
                <span className="chip bg-surface-3 text-ink-3">{e.source}</span>
              </div>
              <div className="text-xs text-ink-2">{e.text}</div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-2xs text-ink-3">Full richer trace (decisions, crew, verification, record corrections) lands in M7.</p>
    </section>
  );
}
