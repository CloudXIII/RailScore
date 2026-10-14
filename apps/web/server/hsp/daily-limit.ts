import "server-only";
import { londonIsoDate } from "@railscore/core";
import { database } from "../db";
import { errorText } from "../error-text";
import { hspDailyCallLimit } from "../env";

export class DailyLimitError extends Error {
  constructor(
    message = "The daily limit for this demo has been reached. Try again tomorrow.",
  ) {
    super(message);
    this.name = "DailyLimitError";
  }
}

/**
 * Reserves one HSP call for today (London). Does nothing when no database is
 * configured. When a database is configured and the counter cannot be updated,
 * the call is refused.
 */
export async function takeDailyCall(now = new Date()): Promise<void> {
  const sql = database();
  if (!sql) {
    return;
  }
  const limit = hspDailyCallLimit();
  const day = londonIsoDate(now);
  try {
    const rows = await sql<{ calls: number }[]>`
      insert into hsp_daily_calls (day, calls)
      values (${day}::date, 1)
      on conflict (day) do update
      set calls = hsp_daily_calls.calls + 1
      where hsp_daily_calls.calls < ${limit}
      returning calls
    `;
    if (rows.length === 0) {
      throw new DailyLimitError();
    }
  } catch (error) {
    if (error instanceof DailyLimitError) {
      throw error;
    }
    console.error("HSP daily limit could not be updated", errorText(error));
    throw new DailyLimitError(
      "The demo is temporarily unavailable. Try again later.",
    );
  }
}
