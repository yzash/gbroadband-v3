"use client";

import { useEffect, useState } from "react";
import type { FaultKind } from "@/lib/types";
import { FAULT_LABEL } from "@/lib/types";

const INJECTORS: FaultKind[] = [
  "feeder_cut",
  "distribution_cut",
  "splitter_failure",
  "olt_port_failure",
  "power_outage",
  "drop_cut",
  "cpe_issue",
];

export function DirectorClient() {
  const [olts, setOlts] = useState<string[]>([]);
  const [coverage, setCoverage] = useState(70);
  const [alarmDelay, setAlarmDelay] = useState(20);
  const [deadOlt, setDeadOlt] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [sim, setSim] = useState<{ simMin: number; running: boolean; speed: number } | null>(null);

  const push = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} · ${s}`, ...l].slice(0, 20));

  useEffect(() => {
    fetch("/api/director/scenario").then((r) => r.json()).then((j) => setOlts(j.olts ?? []));
    const t = setInterval(async () => {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) {
        const s = await r.json();
        setSim(s.sim);
      }
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const inject = async (kind: FaultKind) => {
    const r = await fetch("/api/director/inject", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
    const j = await r.json();
    push(`injected ${kind}${j.fault?.element_id ? ` @ ${j.fault.element_id}` : j.fault?.power_grid ? ` on ${j.fault.power_grid}` : ""}`);
  };
  const scenario = async (name: string) => {
    const r = await fetch("/api/director/scenario", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const j = await r.json();
    push(`${name}: ${JSON.stringify(j)}`);
  };
  const applySensing = async () => {
    await fetch("/api/director/sensing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coverage: coverage / 100, alarm_delay_min: alarmDelay, dead_olt: deadOlt || null }) });
    push(`sensing: coverage ${coverage}% · alarm delay ${alarmDelay}m · dead OLT ${deadOlt || "none"}`);
  };
  const clock = async (body: object) => { await fetch("/api/clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); };
  const reset = async () => { await fetch("/api/reset", { method: "POST" }); push("world reset to seed"); };

  return (
    <div className="min-h-screen bg-base p-6 text-ink">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Scenario Director</h1>
          <div className="text-2xs uppercase tracking-widest text-critical">Never show the audience · drives the walkthrough</div>
        </div>
        <div className="text-right text-xs text-ink-3">
          <div>sim {sim ? `${Math.floor(sim.simMin / 60)}h${String(sim.simMin % 60).padStart(2, "0")}` : "—"}</div>
          <div>{sim?.running ? `running ${sim.speed}×` : "paused"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Injectors */}
        <section className="card p-4">
          <h2 className="section-title mb-2">Fault injectors</h2>
          <div className="flex flex-col gap-1.5">
            {INJECTORS.map((k) => (
              <button key={k} className="btn-ghost justify-start" onClick={() => inject(k)}>
                {FAULT_LABEL[k]}
              </button>
            ))}
            <button className="btn-ghost justify-start text-degraded" onClick={() => scenario("ticket_storm")}>⚡ Ticket storm (valid + invalid)</button>
            <button className="btn-ghost justify-start text-healthy" onClick={() => scenario("quiet")}>☾ Quiet period</button>
          </div>
        </section>

        {/* Sensing Health */}
        <section className="card p-4">
          <h2 className="section-title mb-3">Sensing Health</h2>
          <label className="mb-3 block text-xs text-ink-2">
            Telemetry coverage: <span className="font-mono text-doctrine">{coverage}%</span>
            <input type="range" min={0} max={100} value={coverage} onChange={(e) => setCoverage(Number(e.target.value))} className="mt-1 w-full" />
          </label>
          <label className="mb-3 block text-xs text-ink-2">
            Alarm feed delay (min): <span className="font-mono text-doctrine">{alarmDelay}</span>
            <input type="range" min={0} max={120} value={alarmDelay} onChange={(e) => setAlarmDelay(Number(e.target.value))} className="mt-1 w-full" />
          </label>
          <label className="mb-3 block text-xs text-ink-2">
            Kill an OLT alarm feed:
            <select value={deadOlt} onChange={(e) => setDeadOlt(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-ink">
              <option value="">— none —</option>
              {olts.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <button className="btn-primary w-full" onClick={applySensing}>Apply sensing health</button>
          <p className="mt-2 text-2xs text-ink-3">Degrade coverage, then inject — watch it still find the outage from tickets alone.</p>
        </section>

        {/* Clock + log */}
        <section className="card p-4">
          <h2 className="section-title mb-2">Clock</h2>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button className="btn-ghost" onClick={() => clock({ running: false })}>❙❙ Pause</button>
            <button className="btn-ghost" onClick={() => clock({ running: true, speed: 1 })}>1×</button>
            <button className="btn-ghost" onClick={() => clock({ running: true, speed: 4 })}>4×</button>
            <button className="btn-ghost" onClick={() => clock({ running: true, speed: 16 })}>16×</button>
            <button className="btn-ghost" onClick={() => clock({ advance6h: true })}>⏩ 6h</button>
            <button className="btn-danger" onClick={reset}>↺ Reset</button>
          </div>
          <h2 className="section-title mb-1">Log</h2>
          <div className="max-h-64 overflow-auto rounded bg-base p-2 font-mono text-2xs text-ink-3">
            {log.length === 0 ? "—" : log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </section>
      </div>

      <div className="mt-4 text-2xs text-ink-3">
        <a href="/operations" className="text-doctrine hover:underline">← back to Operations</a> · generic capabilities; the walkthrough doc owns the narrative.
      </div>
    </div>
  );
}
