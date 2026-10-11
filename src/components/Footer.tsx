"use client";

import { useApp } from "./AppState";

export function Footer() {
  const { connected } = useApp();
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-base px-4 text-[10.5px] tracking-wide text-ink-3">
      <span className="font-semibold uppercase tracking-[0.12em] text-watch/90">Demonstration environment · synthetic data</span>
      <span className="flex items-center gap-1.5">
        <span className={["h-1.5 w-1.5 rounded-full", connected ? "bg-healthy" : "bg-watch"].join(" ")} />
        {connected ? "Live stream" : "Polling"}
      </span>
      <span className="ml-auto">Boundaries: PSA PSGC 2023 · Globe Network Assurance · SDAL v5</span>
    </footer>
  );
}
