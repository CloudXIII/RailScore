import { afterResponse } from "@/server/after-response";
import { importDarwin } from "@/server/darwin/import";
import { importSecret } from "@/server/env";
import { errorText } from "@/server/error-text";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
/** Next to Neon (eu-west-2) and the Darwin Kafka cluster (europe-west2). */
export const preferredRegion = "lhr1";

/** Time for the import, leaving the function room to finish before the platform stops it. */
const IMPORT_BUDGET_MS = 240_000;

/**
 * Starts a Darwin import. cron-job.org calls this every 15 minutes with
 * `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET the route is off.
 *
 * cron-job.org closes the connection after 30 seconds, and a catch-up import takes longer,
 * so the route answers 202 at once and imports after the response. The result is in the log.
 * `?wait=1` imports first and answers with the result, for a run by hand.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = importSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Not found", { status: 404 });
  }
  if (new URL(request.url).searchParams.get("wait") !== "1") {
    afterResponse(async () => {
      await runImport();
    });
    return Response.json({ status: "started" }, { status: 202 });
  }
  const result = await runImport();
  if (!result) {
    return Response.json({ status: "failed" }, { status: 500 });
  }
  return Response.json(result, {
    status: result.status === "busy" ? 409 : 200,
  });
}

async function runImport() {
  try {
    const result = await importDarwin(IMPORT_BUDGET_MS);
    console.info("[darwin-import]", JSON.stringify(result));
    return result;
  } catch (error) {
    console.error("[darwin-import] failed", errorText(error));
    return undefined;
  }
}
