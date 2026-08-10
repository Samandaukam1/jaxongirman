export const compactNumber = new Intl.NumberFormat("uz-UZ", { notation: "compact", maximumFractionDigits: 1 });
export const dateTime = new Intl.DateTimeFormat("uz-UZ", { dateStyle: "medium", timeStyle: "short" });
export const dateOnly = new Intl.DateTimeFormat("uz-UZ", { dateStyle: "medium" });
export const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/**
 * PostgREST returns `numeric` columns as strings to avoid the precision loss a
 * JavaScript number would cause, so anything money-shaped has to be coerced
 * before it is formatted — `money.format("0.3567")` silently yields NaN.
 */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * AI spend is measured in fractions of a cent, so rounding everything to two
 * decimals reports $0.0034 as $0.00. Small amounts keep the digits that carry
 * the information; amounts a person would recognise as money do not.
 */
export function usd(value: unknown): string {
  const amount = toNumber(value);
  if (amount !== 0 && Math.abs(amount) < 1) {
    return `$${amount.toFixed(Math.abs(amount) < 0.01 ? 6 : 4)}`;
  }
  return money.format(amount);
}

const somFormatter = new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 0 });

/**
 * A grouped whole number in whatever currency the caller names — module prices
 * and coin packages are configured per currency, so the unit is not assumed.
 */
export function priceIn(value: unknown, currency: string): string {
  return `${somFormatter.format(Math.round(toNumber(value)))} ${currency}`;
}

/** A timestamp column, rendered the one way the console renders them. */
export function stamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

/** Som are never quoted in tiyin, so the value is rounded to whole som. */
export function uzs(usdAmount: unknown, rate: unknown): string {
  const amount = toNumber(usdAmount) * toNumber(rate);
  return `${somFormatter.format(Math.round(amount))} so‘m`;
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Kutilmagan xatolik";
}
