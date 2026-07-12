"use client";

import { useApp } from "./AppState";
import { ROLES } from "@/lib/roles";

export function RoleSwitcher() {
  const { role, setRole } = useApp();
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs uppercase tracking-wider text-ink-3">Role</span>
      <div className="flex rounded-md bg-surface-2 p-0.5">
        {ROLES.map((r) => (
          <button
            key={r.id}
            title={r.blurb}
            onClick={() => setRole(r.id)}
            className={[
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              role === r.id ? "bg-doctrine text-white" : "text-ink-2 hover:text-ink",
            ].join(" ")}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
