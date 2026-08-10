/**
 * Coin and som amounts, grouped with a no-break space so "1 240 tanga"
 * never wraps between the number and its unit.
 *
 * The unit is always the Uzbek word "tanga" — the balance card is the one place
 * that drops it, because the coin illustration beside the figure says the same
 * thing better.
 */

const GROUP_SEPARATOR = " ";

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value);
  return String(Math.abs(rounded))
    .replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR)
    .replace(/^/, rounded < 0 ? "−" : "");
}

/** "1 240 tanga" — the wallet amount wherever it appears as running text. */
export function formatCoins(value: number): string {
  return `${formatNumber(value)}\u00A0tanga`;
}

/** "11 000 UZS" — a configured price, in whatever currency it was configured in. */
export function formatPrice(amount: number, currency: string): string {
  return `${formatNumber(amount)} ${currency}`;
}

/** "3 MB", "820 KB" — file sizes in upload errors and helper text. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(bytes >= 10_485_760 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "12 000 so'm" — marketplace prices, which are som rather than coins. */
export function formatSom(value: number): string {
  return `${formatNumber(value)} so‘m`;
}
