import "server-only";
import { database } from "./db";
import { darwinKeepDays } from "./env";
import { errorText } from "./error-text";
import { deleteOldBacklog } from "./hsp/store";

/**
 * Housekeeping the import route runs after a Darwin import: HSP rows the searches no longer
 * read. A failure is logged and leaves the import's result as it is.
 */
export async function deleteOldRows(now = new Date()): Promise<void> {
  const sql = database();
  if (!sql) {
    return;
  }
  try {
    await deleteOldBacklog(sql, darwinKeepDays(), now);
  } catch (error) {
    console.error("Old HSP rows could not be deleted", errorText(error));
  }
}
