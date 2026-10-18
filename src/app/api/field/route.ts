import { NextResponse } from "next/server";
import { bootEngine } from "@/lib/engine";
import { getFieldData } from "@/lib/persona-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  bootEngine();
  return NextResponse.json(getFieldData());
}
