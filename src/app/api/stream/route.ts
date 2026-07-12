import { getSnapshotJson, subscribe } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-sent events: push the live snapshot on every engine tick.
export async function GET() {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (json: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${json}\n\n`));
        } catch {
          /* controller closed */
        }
      };
      send(getSnapshotJson()); // initial frame
      unsub = subscribe(send);
      // Comment ping keeps intermediaries from closing an idle (paused) stream.
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* ignore */
        }
      }, 15000);
    },
    cancel() {
      unsub?.();
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
