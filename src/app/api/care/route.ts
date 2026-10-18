import { NextResponse } from "next/server";
import { bootEngine } from "@/lib/engine";
import { callersNow, getCallerAnswer, pendingOf, searchCallers } from "@/lib/persona-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Customer Service: ?q= searches callers, ?line= answers for one line. */
export function GET(req: Request) {
  bootEngine();
  const url = new URL(req.url);
  const line = url.searchParams.get("line");
  const term = url.searchParams.get("q");
  return NextResponse.json({
    callers: callersNow(),
    matches: term ? searchCallers(term) : [],
    answer: line ? getCallerAnswer(line) : null,
    pending: pendingOf(["notification", "credit"]),
  });
}
