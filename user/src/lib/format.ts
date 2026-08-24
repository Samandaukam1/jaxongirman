const relativeUnits: readonly (readonly [label: string, seconds: number])[] = [
  ["yil", 31_536_000],
  ["oy", 2_592_000],
  ["hafta", 604_800],
  ["kun", 86_400],
  ["soat", 3_600],
  ["daqiqa", 60],
];

/**
 * Hermes ships without `Intl.RelativeTimeFormat`, so format directly rather than
 * pull in an ICU polyfill for the one locale this app speaks.
 */
export function formatRelativeDate(value: string): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((time - Date.now()) / 1000);
  const magnitude = Math.abs(seconds);

  for (const [label, size] of relativeUnits) {
    if (magnitude >= size) {
      const amount = Math.round(magnitude / size);
      return seconds < 0 ? `${amount} ${label} oldin` : `${amount} ${label}dan keyin`;
    }
  }
  return "hozir";
}

export function asErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  // Supabase reports failures as plain objects, not Error instances — a
  // PostgrestError is `{ message, details, hint, code }`. Treating those as
  // "unexpected" threw away the one sentence that said what went wrong, and
  // left every database refusal looking identical on screen.
  if (error && typeof error === "object") {
    const row = error as { message?: unknown; error_description?: unknown; hint?: unknown };
    for (const field of [row.message, row.error_description, row.hint]) {
      if (typeof field === "string" && field.trim()) return field;
    }
  }
  if (typeof error === "string" && error.trim()) return error;
  return "Kutilmagan xatolik yuz berdi";
}

/**
 * `functions.invoke()` reports every failure as "Edge Function returned a non-2xx
 * status code" and hides the response on `error.context`. Our functions answer with
 * `{ error, code }`, so read that instead of showing the useless generic message.
 */
export async function asFunctionErrorMessage(error: unknown): Promise<string> {
  /**
   * Duck-typed, not `instanceof Response`.
   *
   * React Native's fetch is a polyfill, and the object supabase-js hands back
   * as `error.context` did not pass `instanceof Response` against the global
   * one. So this branch never ran on a phone: the server would answer 400 with
   * `{"error":"ready presentation not found"}` and the person was shown "Edge
   * Function returned a non-2xx status code", which describes the transport and
   * says nothing about what happened. Every function failure in the app looked
   * like the same nameless failure for that reason.
   */
  const response = (error as { context?: unknown })?.context as
    | { clone?: unknown; json?: unknown; text?: unknown }
    | undefined;
  if (response && (typeof response.json === "function" || typeof response.text === "function")) {
    try {
      const source = typeof response.clone === "function"
        ? (response.clone as () => NonNullable<typeof response>)()
        : response;
      const body = typeof source.json === "function"
        ? await (source.json as () => Promise<{ error?: unknown }>)()
        : JSON.parse(await (source.text as () => Promise<string>)()) as { error?: unknown };
      if (typeof body.error === "string" && body.error) return body.error;
    } catch {
      // Not JSON, or already consumed — fall back to the generic message.
    }
  }
  return asErrorMessage(error);
}
