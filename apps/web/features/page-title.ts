/** Browser tab title. A journey names both stations; otherwise the app name. */
export function pageTitle(from?: string, to?: string): string {
  if (!from || !to) {
    return "RailScore";
  }
  return `${from} to ${to} · RailScore`;
}
