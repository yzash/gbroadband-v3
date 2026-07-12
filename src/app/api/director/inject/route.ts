import { NextResponse } from "next/server";
import { injectScenario } from "@/lib/engine";
import type { FaultKind } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    kind?: FaultKind;
    element_id?: string | null;
    power_grid?: string | null;
    autoClearMin?: number | null;
  };
  if (!body.kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
  const fault = injectScenario(body.kind, {
    element_id: body.element_id ?? null,
    power_grid: body.power_grid ?? null,
    autoClearMin: body.autoClearMin ?? null,
  });
  return NextResponse.json({ ok: true, fault });
}
