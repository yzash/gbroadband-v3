import { NextResponse } from "next/server";
import { acceptRecordCorrection } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const ok = acceptRecordCorrection(params.id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
}
