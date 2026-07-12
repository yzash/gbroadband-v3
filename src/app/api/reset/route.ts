import { NextResponse } from "next/server";
import { placeholderSnapshot } from "@/lib/placeholder";

export const dynamic = "force-dynamic";

// M0 placeholder — M2 restores the seeded world here (≤2s).
export async function POST() {
  return NextResponse.json(placeholderSnapshot());
}
