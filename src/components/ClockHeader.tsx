"use client";

import { useApp } from "./AppState";
import { RoleSwitcher } from "./RoleSwitcher";
import { fmtSimTime } from "@/lib/tokens";

const SPEEDS: { v: 0 | 1 | 4 | 16; label: string }[] = [
  { v: 1, label: "1×" },
  { v: 4, label: "4×" },
  { v: 16, label: "16×" },
];

export function ClockHeader() {
  const { snapshot, connected, setClock, reset } = useApp();
  const sim = snapshot?.sim;
  const running = sim?.running ?? false;
  const speed = sim?.speed ?? 0;

  return (
    <header className="flex items-center gap-4 border-b border-line bg-surface px-5 py-2.5">
      {/* Sim clock */}
      <div className="flex items-center gap-2">
        <span
          className={[
            "inline-block h-2 w-2 rounded-full",
            connected ? "bg-live animate-pulse2" : "bg-ink-3",
          ].join(" ")}
          title={connected ? "Live stream connected" : "Polling fallback"}
        />
        <span className="font-mono text-sm tabular-nums text-ink">
          {sim ? fmtSimTime(sim.simMin) : "—"}
        </span>
        <span className="text-2xs text-ink-3">SIM CLOCK</span>
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-1 rounded-md bg-surface-2 p-0.5">
        <button
          className={[
            "rounded px-2 py-1 text-xs font-medium",
            !running ? "bg-surface-3 text-ink" : "text-ink-2 hover:text-ink",
          ].join(" ")}
          onClick={() => setClock({ running: false })}
          title="Pause"
        >
          ❙❙
        </button>
        {SPEEDS.map((s) => (
          <button
            key={s.v}
            className={[
              "rounded px-2 py-1 text-xs font-medium tabular-nums",
              running && speed === s.v ? "bg-doctrine text-white" : "text-ink-2 hover:text-ink",
            ].join(" ")}
            onClick={() => setClock({ running: true, speed: s.v })}
          >
            {s.label}
          </button>
        ))}
        <button
          className="rounded px-2 py-1 text-xs font-medium text-ink-2 hover:text-ink"
          onClick={() => setClock({ advance6h: true })}
          title="Advance 6 hours"
        >
          ⏩ 6h
        </button>
      </div>

      <button className="btn-ghost text-xs" onClick={() => reset()} title="Restore seeded world">
        ↺ Reset
      </button>

      <div className="ml-auto flex items-center gap-3">
        <RoleSwitcher />
      </div>
    </header>
  );
}
