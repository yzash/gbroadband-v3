"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/operations", label: "Operations", glyph: "◉", hint: "NOC command · Sense" },
  { href: "/detections", label: "Detections", glyph: "◎", hint: "Sense → Decide handoff" },
  { href: "/incidents", label: "Incident Room", glyph: "▤", hint: "Decide + Act" },
  { href: "/proposals", label: "Proposals & Audit", glyph: "✎", hint: "Approvals + trail" },
  { href: "/learn", label: "Learn", glyph: "↻", hint: "Lift · deflection · corrections" },
  { href: "/ask", label: "Ask (GE)", glyph: "✦", hint: "Ask the network" },
  { href: "/configurations", label: "Configurations", glyph: "⚙", hint: "Registry · same loop" },
];

export function LeftRail() {
  const path = usePathname();
  return (
    <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-line bg-surface px-3 py-4">
      <Link href="/operations" className="mb-4 flex items-center gap-2 px-2">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-doctrine/20 text-doctrine font-bold">S</div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">SDAL</div>
          <div className="text-2xs text-ink-3">Broadband Intelligence</div>
        </div>
      </Link>

      <div className="mb-1 px-2 text-2xs uppercase tracking-wider text-ink-3">Sense · Decide · Act · Learn</div>

      {NAV.map((item) => {
        const active = path === item.href || (item.href !== "/operations" && path.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "group flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
              active
                ? "bg-doctrine/15 text-ink"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            ].join(" ")}
          >
            <span className={active ? "text-doctrine" : "text-ink-3 group-hover:text-ink-2"}>{item.glyph}</span>
            <span className="flex-1">{item.label}</span>
          </Link>
        );
      })}

      <div className="mt-auto px-2 pt-4 text-2xs text-ink-3">
        <div>Retention &amp; Care</div>
        <div className="text-healthy">● ACTIVE configuration</div>
      </div>
    </nav>
  );
}
