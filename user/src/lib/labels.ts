import { i18n } from "../i18n";
import type labels from "../i18n/ns/labels";

type Labels = (typeof labels)["uz"];
type Table = Extract<keyof Labels, string>;

/**
 * The name of a server code in the app's language — "ready" as "Tayyor",
 * "Ready" or "Готово". A code this build has no name for is shown as it is.
 */
export function labelOf(table: Table, code: string | null | undefined): string {
  if (!code) return "";
  const key = `labels:${table}.${code}`;
  return i18n.exists(key) ? i18n.t(key as "labels:gameStatus.ready") : code;
}
