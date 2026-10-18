"use client";

import Link from "next/link";
import { PersonaAvatar } from "@/components/RoleSwitcher";
import { useLive } from "@/components/persona/kit";
import { personaFor } from "@/lib/personas";
import type { Role } from "@/lib/roles";

interface Handoffs {
  proposals: { id: string; kind: string; state: string; decided_by_role: string | null; payload_json: string }[];
  jobs: { id: string; crew_type: string; state: string }[];
  reports: { id: string; crew_type: string; first_time_fix: number; discrepancies: number }[];
  notes: { kind: string; lines_count: number; before_call: number }[];
  callers: number;
}

type Tone = "done" | "pending" | "active" | "idle";

/** Who is doing what on this incident right now — the persona dynamics, live. */
export function HandoffStrip({ incidentId, fault }: { incidentId: string; fault: string | null }) {
  const [d] = useLive<Handoffs>(`/api/handoffs?incident=${incidentId}`);
  if (!d) return null;
  const prop = (k: string) => d.proposals.find((p) => p.kind === k);
  const note = (k: string) => d.notes.filter((n) => n.kind === k);
  const sum = (xs: { lines_count: number }[]) => xs.reduce((a, n) => a + n.lines_count, 0);
  const st = (k: string): Tone => {
    const p = prop(k);
    return !p ? "idle" : p.state === "pending" ? "pending" : p.state === "rejected" ? "idle" : "done";
  };

  const partnerJob = d.jobs.find((j) => j.crew_type === "partner" && j.state !== "done");
  const partnerReport = d.reports.find((r) => r.crew_type === "partner");
  const cfsJob = d.jobs.find((j) => j.crew_type === "cfs");
  const progress = note("progress");
  const accounts = note("account");

  const cells: { role: Role; tone: Tone; text: string; href: string }[] = [
    {
      role: "noc_lead",
      tone: fault === "power_outage" ? "done" : st("dispatch") === "idle" ? (st("remote_action") === "idle" ? "active" : st("remote_action")) : st("dispatch"),
      text:
        fault === "power_outage"
          ? "No fiber crew — utility outage"
          : prop("dispatch")?.state === "pending"
          ? "Dispatch awaiting approval"
          : prop("dispatch")
          ? "Dispatch approved"
          : prop("remote_action")
          ? prop("remote_action")!.state === "pending"
            ? "Remote fix awaiting approval"
            : "Remote fix run"
          : "Isolating the fault",
      href: `/incidents?id=${incidentId}`,
    },
    {
      role: "partner",
      tone: partnerReport ? "done" : partnerJob ? "active" : "idle",
      text: partnerReport
        ? `Close-out filed${partnerReport.discrepancies ? ` · ${partnerReport.discrepancies} record errors` : ""}`
        : partnerJob
        ? partnerJob.state === "onsite"
          ? "Crew on site"
          : "Crew en route with brief"
        : "Not dispatched",
      href: "/partners",
    },
    {
      role: "customer_service",
      tone: progress.length ? "done" : st("notification"),
      text: progress.length
        ? `${sum(progress)} told cause + ETA · ${progress.reduce((a, n) => a + n.before_call, 0)} before they called`
        : prop("notification")
        ? "Notice awaiting approval"
        : `${d.callers} callers so far`,
      href: "/care",
    },
    {
      role: "cfs_tech",
      tone: cfsJob ? "active" : fault === "cpe_issue" ? st("home_visit") : "done",
      text: cfsJob
        ? cfsJob.state === "done"
          ? "Home visit done"
          : "Home visit booked"
        : fault === "cpe_issue"
        ? prop("home_visit")
          ? "Home visit awaiting approval"
          : "Remote fix first"
        : `${d.callers} callers — no home visits needed`,
      href: "/field",
    },
    {
      role: "sales_force",
      tone: accounts.length ? "done" : st("account_alert"),
      text: accounts.length ? `${sum(accounts)} business accounts briefed` : prop("account_alert") ? "Account heads-up awaiting approval" : "No business accounts hit",
      href: "/sales",
    },
    {
      role: "marketing",
      tone: prop("campaign_hold") || prop("retention_offer") ? (st("campaign_hold") === "pending" || st("retention_offer") === "pending" ? "pending" : "done") : "idle",
      text: [
        prop("campaign_hold") ? (prop("campaign_hold")!.state === "pending" ? "Campaign hold proposed" : prop("campaign_hold")!.state === "rejected" ? "" : "Campaigns paused") : "",
        prop("retention_offer") ? (prop("retention_offer")!.state === "pending" ? "offer proposed" : "retention offer sent") : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Watching — no action yet",
      href: "/marketing",
    },
  ];

  const toneCls: Record<Tone, string> = {
    done: "border-healthy/40 bg-healthy/[0.07]",
    pending: "border-watch/50 bg-watch/[0.08]",
    active: "border-globe-sky/40 bg-globe/20",
    idle: "border-line bg-surface-2",
  };
  const dot: Record<Tone, string> = { done: "bg-healthy", pending: "bg-watch animate-pulse2", active: "bg-globe-sky", idle: "bg-ink-3" };

  return (
    <section className="card p-4" data-testid="handoffs">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="section-title">Who&rsquo;s on it · persona hand-offs for this incident</h3>
        <Link href="/personas" className="text-[11.5px] font-semibold text-globe-sky hover:underline">How the teams work together</Link>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-6">
        {cells.map((c) => {
          const p = personaFor(c.role);
          return (
            <Link key={c.role} href={c.href} className={`rounded-md border px-3 py-2 transition-colors hover:border-globe-sky/60 ${toneCls[c.tone]}`}>
              <div className="flex items-center gap-2">
                <PersonaAvatar p={p} size={22} />
                <span className="text-[12px] font-bold text-ink">{p.group}</span>
                <span className={`ml-auto h-2 w-2 rounded-full ${dot[c.tone]}`} />
              </div>
              <div className="mt-1 text-[12px] leading-snug text-ink-2">{c.text}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
