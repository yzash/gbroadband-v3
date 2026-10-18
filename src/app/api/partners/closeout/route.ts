import { NextResponse } from "next/server";
import { submitCloseout } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Partner portal: a crew on site files its close-out now. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { jobId?: string; role?: string };
  if (!body.jobId) return NextResponse.json({ ok: false, error: "jobId required" }, { status: 400 });
  if (body.role !== "partner") return NextResponse.json({ ok: false, error: "only the last-mile partner files a close-out" }, { status: 403 });
  const res = submitCloseout(body.jobId);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
}
