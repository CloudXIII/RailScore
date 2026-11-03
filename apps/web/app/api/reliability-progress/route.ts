import { readCalculationProgress } from "@/server/hsp/calculation-progress";

export const dynamic = "force-dynamic";
/** Same region as the home page, which writes the progress this route reads. */
export const preferredRegion = "lhr1";

export function GET(request: Request): Response {
  const service = new URL(request.url).searchParams.get("service") ?? "";
  const now = Date.now();
  const progress = service ? readCalculationProgress(service, now) : undefined;
  return Response.json({
    saved: progress?.saved ?? null,
    total: progress?.total ?? null,
    ageMs: progress ? now - progress.updatedAt : null,
    provisional: progress?.provisional ?? null,
  });
}
