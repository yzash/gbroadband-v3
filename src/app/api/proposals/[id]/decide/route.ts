import { NextResponse } from "next/server";
import { decide } from "@/lib/engine";
import type { Role } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as {
    decision?: "approve" | "reject" | "edit";
    role?: Role;
    rationale?: string;
  };
  if (!body.decision || !body.role) return NextResponse.json({ error: "decision and role required" }, { status: 400 });
  const res = decide(params.id, body.decision, body.role, body.rationale);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}
