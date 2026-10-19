import "server-only";
import { after } from "next/server";
import { errorText } from "./error-text";

/**
 * Runs `task` once the response is sent, within the request's time limit.
 * Outside a request, as in a script, it starts at once.
 */
export function afterResponse(task: () => Promise<void>): void {
  const guarded = () =>
    task().catch((error: unknown) => {
      console.error("Background work failed", errorText(error));
    });
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
