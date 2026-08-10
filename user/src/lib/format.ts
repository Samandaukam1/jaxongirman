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
  return error instanceof Error ? error.message : "Kutilmagan xatolik yuz berdi";
}

/**
 * `functions.invoke()` reports every failure as "Edge Function returned a non-2xx
 * status code" and hides the response on `error.context`. Our functions answer with
 * `{ error, code }`, so read that instead of showing the useless generic message.
 */
export async function asFunctionErrorMessage(error: unknown): Promise<string> {
  const response = (error as { context?: unknown })?.context;
  if (response instanceof Response) {
    try {
      const body = (await response.clone().json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error) return body.error;
    } catch {
      // Not JSON — fall back to the generic message below.
    }
  }
  return asErrorMessage(error);
}
