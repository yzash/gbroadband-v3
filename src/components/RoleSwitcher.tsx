"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Users } from "lucide-react";
import { useApp } from "./AppState";
import { PERSONAS, READONLY_PERSONA, personaFor, type Persona } from "@/lib/personas";

export function PersonaAvatar({ p, size = 28 }: { p: Persona; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-display font-bold text-[#040918]"
      style={{ width: size, height: size, background: p.color, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {p.initials}
    </span>
  );
}

/** Persona picker: who you are acting as gates what you can approve. */
export function RoleSwitcher() {
  const { role, setRole } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = personaFor(role);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 items-center gap-2.5 rounded-md border border-line bg-surface-2 py-1 pl-1.5 pr-2.5 text-left hover:border-line-2"
        data-testid="persona-picker"
      >
        <PersonaAvatar p={active} />
        <span className="hidden leading-tight sm:block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-3">Acting as</span>
          <span className="block text-[12.5px] font-semibold text-ink">
            {active.name} <span className="font-normal text-ink-2">· {active.title}</span>
          </span>
        </span>
        <ChevronDown size={14} className="text-ink-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-[380px] overflow-hidden rounded-lg border border-line-2 bg-surface shadow-float" role="listbox" aria-label="Persona">
          <div className="border-b border-line px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
            Switch persona · decides what you can approve
          </div>
          {[...PERSONAS, READONLY_PERSONA].map((p) => {
            const on = p.role === role;
            return (
              <button
                key={p.role}
                role="option"
                aria-selected={on}
                onClick={() => {
                  setRole(p.role);
                  setOpen(false);
                }}
                className={["flex w-full items-start gap-3 px-3 py-2 text-left", on ? "bg-globe/30" : "hover:bg-surface-2"].join(" ")}
              >
                <PersonaAvatar p={p} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink">
                    {p.name} <span className="font-normal text-ink-2">· {p.title}</span>
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-3">{p.team} — {p.owns}</span>
                </span>
                {on && <Check size={15} className="mt-1 text-globe-sky" />}
              </button>
            );
          })}
          <Link
            href="/personas"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12px] font-semibold text-globe-sky hover:bg-surface-2"
          >
            <Users size={14} /> How the personas work together
          </Link>
        </div>
      )}
    </div>
  );
}
