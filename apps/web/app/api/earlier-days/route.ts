import { errorText } from "@/server/error-text";
import { parseEarlierDaysQuery } from "@/server/hsp/earlier-days-query";
import { streamEarlierDays } from "@/server/hsp/earlier-days";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
/** Next to Neon (eu-west-2) and HSP. */
export const preferredRegion = "lhr1";

/** No new HSP call starts after this, so the last one ends inside `maxDuration`. */
const BUDGET_MS = 60_000;

/**
 * HSP figures for the days before Darwin, for trains a page already listed. The answer is
 * newline-delimited JSON, one event per line as each result arrives (see EarlierDaysEvent).
 */
export async function POST(request: Request): Promise<Response> {
  const query = parseEarlierDaysQuery(
    await request.json().catch(() => undefined),
  );
  if (!query) {
    return new Response("Bad request", { status: 400 });
  }
  const encoder = new TextEncoder();
  const deadline = Date.now() + BUDGET_MS;
  // The page went away: no new HSP call starts. Either signal may come first.
  const gone = new AbortController();
  request.signal.addEventListener("abort", () => gone.abort());
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      gone.abort();
    },
    async start(controller) {
      let open = true;
      const emit = (event: unknown) => {
        if (!open) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
          gone.abort();
        }
      };
      try {
        await streamEarlierDays(query, emit, { signal: gone.signal, deadline });
      } catch (error) {
        console.error("The HSP earlier days failed", errorText(error));
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
