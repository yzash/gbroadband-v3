import { placeholderSnapshot } from "@/lib/placeholder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// M0 placeholder SSE — emits the snapshot every 2s. M2 replaces this with a
// real subscription to the engine's tick events.
export async function GET() {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        const payload = JSON.stringify(placeholderSnapshot());
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };
      send();
      timer = setInterval(send, 2000);
    },
    cancel() {
      if (timer) clearInterval(timer);
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
