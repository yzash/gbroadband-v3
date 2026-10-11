"use client";

import Link from "next/link";
import { FastForward, Pause, Play, RotateCcw } from "lucide-react";
import { useApp } from "./AppState";
import { RoleSwitcher } from "./RoleSwitcher";
import { fmtSimTime } from "@/lib/tokens";

const SPEEDS: { v: 1 | 4 | 16; label: string }[] = [
  { v: 1, label: "1×" },
  { v: 4, label: "4×" },
  { v: 16, label: "16×" },
];

/** Brand lockup. A neutral orbit mark — drop the official Globe logo into
 *  BrandMark when the brand guide arrives. */
export function BrandMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <rect width="30" height="30" rx="8" fill="#0033A0" />
      <circle cx="15" cy="15" r="6.2" fill="none" stroke="#fff" strokeWidth="2.2" />
      <path d="M5.5 18.5c3.5 3.2 15.5 3.2 19-0.5" fill="none" stroke="#3CB7FF" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="23.2" cy="10.3" r="1.7" fill="#3CB7FF" />
    </svg>
  );
}

export function TopBar() {
  const { snapshot, connected, setClock, reset } = useApp();
  const sim = snapshot?.sim;
  const running = !!sim?.running && (sim?.speed ?? 0) > 0;
  const speed = sim?.speed ?? 0;

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <Link href="/operations" className="flex items-center gap-3 pr-1" aria-label="Globe Network Assurance home">
        <BrandMark />
        <div className="leading-none">
          <div className="font-display text-[17px] font-extrabold tracking-tight text-ink">Globe</div>
          <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Network Assurance <span className="text-globe-sky">· SDAL</span>
          </div>
        </div>
      </Link>

      <div className="h-8 w-px bg-line" />

      {/* Sim clock + transport */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
          <span
            className={["h-2 w-2 rounded-full", running ? "bg-healthy animate-pulse2" : "bg-ink-3"].join(" ")}
            title={connected ? "Live stream connected" : "Polling fallback"}
          />
          <span className="font-mono text-[13px] tabular-nums text-ink">{sim ? fmtSimTime(sim.simMin) : "—"}</span>
          <span
            className={[
              "rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wider",
              running ? "bg-healthy/15 text-healthy" : "bg-surface-3 text-ink-3",
            ].join(" ")}
          >
            {running ? `Live ${speed}×` : "Paused"}
          </span>
        </div>

        <div className="flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5" role="group" aria-label="Simulation speed">
          <button
            className={["grid h-7 w-8 place-items-center rounded", !running ? "bg-surface-3 text-ink" : "text-ink-2 hover:text-ink"].join(" ")}
            onClick={() => setClock({ running: false })}
            title="Pause"
            aria-label="Pause"
          >
            <Pause size={14} />
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s.v}
              className={[
                "flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold tabular-nums",
                running && speed === s.v ? "bg-doctrine text-white" : "text-ink-2 hover:text-ink",
              ].join(" ")}
              onClick={() => setClock({ running: true, speed: s.v })}
              aria-label={`Run at ${s.label}`}
            >
              {s.v === 1 && <Play size={11} />}
              {s.label}
            </button>
          ))}
          <button
            className="flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold text-ink-2 hover:text-ink"
            onClick={() => setClock({ advance6h: true })}
            title="Advance 6 hours"
          >
            <FastForward size={13} /> 6h
          </button>
        </div>

        <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => reset()} title="Restore the seeded world">
          <RotateCcw size={13} /> Reset
        </button>
      </div>

      <div className="ml-auto">
        <RoleSwitcher />
      </div>
    </header>
  );
}
