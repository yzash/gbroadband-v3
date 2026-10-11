"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BrainCircuit,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  Map,
  Radar,
  Settings2,
  Siren,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useApp } from "./AppState";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "incidents";
}

// Grouped by the loop stage each screen serves.
const GROUPS: { stage: string; items: Item[] }[] = [
  {
    stage: "Sense",
    items: [
      { href: "/operations", label: "Network Map", icon: Map },
      { href: "/detections", label: "Detections", icon: Radar },
    ],
  },
  {
    stage: "Decide · Act",
    items: [
      { href: "/incidents", label: "Incident Room", icon: Siren, badge: "incidents" },
      { href: "/proposals", label: "Approvals & Audit", icon: ClipboardCheck },
    ],
  },
  { stage: "Learn", items: [{ href: "/learn", label: "Learn", icon: BrainCircuit }] },
  { stage: "Assist", items: [{ href: "/ask", label: "Ask the Network", icon: Sparkles }] },
  { stage: "Platform", items: [{ href: "/configurations", label: "Configurations", icon: Settings2 }] },
];

export function LeftRail() {
  const path = usePathname();
  const { snapshot } = useApp();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem("sdal.rail");
      if (v) setOpen(v === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem("sdal.rail", o ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !o;
    });
  };

  const openIncidents = snapshot?.incidents.filter((i) => i.state !== "resolved").length ?? 0;

  return (
    <nav
      className={["flex shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200", open ? "w-[216px]" : "w-[60px]"].join(" ")}
      aria-label="Primary"
    >
      <div className="flex-1 overflow-y-auto py-3">
        {GROUPS.map((g) => (
          <div key={g.stage} className="mb-2">
            {open ? (
              <div className="px-5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3/80">{g.stage}</div>
            ) : (
              <div className="mx-4 my-2 h-px bg-line" />
            )}
            {g.items.map((item) => {
              const active = path === item.href || path.startsWith(item.href + "/");
              const Icon = item.icon;
              const count = item.badge === "incidents" ? openIncidents : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  className={[
                    "group relative mx-2 flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                    active ? "bg-globe/40 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                  ].join(" ")}
                >
                  {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-globe-sky" />}
                  <Icon size={18} strokeWidth={1.8} className={["shrink-0", active ? "text-globe-sky" : "text-ink-3 group-hover:text-ink-2"].join(" ")} />
                  {open && <span className="flex-1 truncate font-semibold">{item.label}</span>}
                  {count > 0 && (
                    <span
                      className={[
                        "grid min-w-[20px] place-items-center rounded-full bg-critical px-1.5 text-[10px] font-bold tabular-nums text-white",
                        open ? "" : "absolute right-1.5 top-1 h-4 min-w-[16px] px-1",
                      ].join(" ")}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-line px-3 py-3">
        {open ? (
          <div className="rounded-md bg-surface-2 px-3 py-2 text-[11px] leading-tight">
            <div className="text-ink-3">Configuration</div>
            <div className="mt-0.5 flex items-center gap-1.5 font-semibold text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-healthy" /> Retention &amp; Care
            </div>
          </div>
        ) : null}
        <button
          onClick={toggle}
          className="mt-2 flex h-8 w-full items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
          aria-label={open ? "Collapse navigation" : "Expand navigation"}
        >
          {open ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
        </button>
      </div>
    </nav>
  );
}
