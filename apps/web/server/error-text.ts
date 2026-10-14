/** Text for a log line. Database errors can be long, so the message is cut. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : "unknown error";
}
