import { NextResponse } from "next/server";
import { placeholderSnapshot } from "@/lib/placeholder";

export const dynamic = "force-dynamic";

// M0 placeholder — M2 wires this to the live engine snapshot.
export function GET() {
  return NextResponse.json(placeholderSnapshot());
}
