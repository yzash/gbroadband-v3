"use client";

import { fmtSimTime } from "@/lib/tokens";

interface Detail {
  events: { sim_ts: number; kind: string; text: string; source: string }[];
}

// Map each event kind to a loop stage + colour.
const STAGE: Record<string, { stage: "Sense" | "Decide" | "Act" | "Learn"; color: string }> = {
  signal: { stage: "Sense", color: "#3CB7FF" },
  detection: { stage: "Sense", color: "#3CB7FF" },
  inject: { stage: "Sense", color: "#3CB7FF" },
  proposal: { stage: "Decide", color: "#A98BFF" },
  hold: { stage: "Decide", color: "#A98BFF" },
  guardrail: { stage: "Decide", color: "#A98BFF" },
  test: { stage: "Decide", color: "#A98BFF" },
  decision: { stage: "Act", color: "#2F6BFF" },
  dispatch: { stage: "Act", color: "#2F6BFF" },
  crew: { stage: "Act", color: "#2F6BFF" },
  remote: { stage: "Act", color: "#2F6BFF" },
  notify: { stage: "Act", color: "#2F6BFF" },
  credit: { stage: "Act", color: "#2F6BFF" },
  repair: { stage: "Learn", color: "#1FC98E" },
  verify: { stage: "Learn", color: "#1FC98E" },
  reopen: { stage: "Learn", color: "#FF4D5E" },
  correction: { stage: "Learn", color: "#1FC98E" },
};

/** Loop Trace — the incident's full Sense → Decide → Act → Learn timeline. */
export function LoopTrace({ detail }: { detail: Detail }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="section-title">Loop Trace</h3>
        <div className="flex items-center gap-2 text-2xs text-ink-3">
          <Legend color="#3CB7FF" label="Sense" />
          <Legend color="#A98BFF" label="Decide" />
          <Legend color="#2F6BFF" label="Act" />
          <Legend color="#1FC98E" label="Learn" />
        </div>
      </div>
      {detail.events.length === 0 ? (
        <p className="text-xs text-ink-3">Trace builds as the incident progresses — first ticket → burst → isolation → decisions → crew → verification → outcomes.</p>
      ) : (
        <ol className="relative ml-1 border-l border-line pl-4">
          {detail.events.map((e, i) => {
            const s = STAGE[e.kind] ?? { stage: "Act", color: "#7586AE" };
            return (
              <li key={i} className="mb-2.5">
                <span
                  className="absolute -left-[7px] mt-1 h-3.5 w-3.5 rounded-full border-2 border-base"
                  style={{ background: s.color }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-2xs text-ink-3">{fmtSimTime(e.sim_ts)}</span>
                  <span className="chip" style={{ background: `${s.color}22`, color: s.color }}>
                    {s.stage}
                  </span>
                  <span className="text-2xs text-ink-3">{e.source}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-2">{e.text}</div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <i className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
