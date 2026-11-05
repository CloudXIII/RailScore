/** Helpers for reading JSON from outside services, where nothing about the shape is promised. */

/** The value as a plain object, or undefined for anything else, arrays included. */
export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The value as trimmed text, or "" when it is not a string. */
export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
