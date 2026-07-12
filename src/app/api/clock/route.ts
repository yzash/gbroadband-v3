import { NextResponse } from "next/server";
import { placeholderSnapshot } from "@/lib/placeholder";

export const dynamic = "force-dynamic";

// M0 placeholder — M2 applies clock commands to the live engine.
export async function POST() {
  return NextResponse.json(placeholderSnapshot());
}
