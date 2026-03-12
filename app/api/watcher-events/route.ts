import { watcherEvents } from "@/lib/watcher-events";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  function cleanup() {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = watcherEvents.subscribe((event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // Controller may already be closed — ignore
        }
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          cleanup();
        }
      }, 30000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
