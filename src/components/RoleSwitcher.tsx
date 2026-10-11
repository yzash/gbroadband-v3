"use client";

import { Eye, Headset, Wrench } from "lucide-react";
import { useApp } from "./AppState";
import { ROLES, type Role } from "@/lib/roles";

const ICON: Record<Role, typeof Eye> = { noc_lead: Wrench, cx_ops: Headset, readonly: Eye };

export function RoleSwitcher() {
  const { role, setRole } = useApp();
  const active = ROLES.find((r) => r.id === role);
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right leading-tight xl:block">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Acting as</div>
        <div className="text-xs text-ink-2">{active?.blurb}</div>
      </div>
      <div className="flex rounded-md border border-line bg-surface-2 p-0.5" role="radiogroup" aria-label="Role">
        {ROLES.map((r) => {
          const Icon = ICON[r.id];
          const on = role === r.id;
          return (
            <button
              key={r.id}
              role="radio"
              aria-checked={on}
              title={r.blurb}
              onClick={() => setRole(r.id)}
              className={[
                "flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-semibold transition-colors",
                on ? "bg-globe text-white shadow-[inset_0_0_0_1px_rgba(60,183,255,0.45)]" : "text-ink-2 hover:text-ink",
              ].join(" ")}
            >
              <Icon size={13} className={on ? "text-globe-sky" : ""} />
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
