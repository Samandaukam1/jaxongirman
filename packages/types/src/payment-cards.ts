/**
 * Pure payment-card display helpers shared by every checkout surface.
 *
 * These functions deliberately know nothing about Supabase or a payment
 * provider. They only enforce the product's partial-card contract:
 *
 *   * a payable PAN is exactly 16 digits;
 *   * the only persistable/displayable representation is ########XXXX####;
 *   * reconstructing it requires exactly four freshly entered digits; and
 *   * expiry is MM/YY, with the current month remaining valid through its end.
 *
 * Keeping the rules here prevents the native and browser checkouts from slowly
 * accepting different card shapes. None of these helpers stores anything.
 */

export type CardExpiryError = "incomplete" | "invalid_month" | "expired";

export type CardExpiryValidation =
  | {
      valid: true;
      digits: string;
      normalized: string;
      month: number;
      /** Two-digit year, exactly as it is stored in `partial_cards`. */
      year: number;
    }
  | {
      valid: false;
      digits: string;
      error: CardExpiryError;
    };

/** Digits only, suitable for transient input state. */
export function cardDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/** Groups a full or partial display PAN without revealing or inventing digits. */
export function formatCardPan(value: string): string {
  const display = value.toUpperCase().replace(/[^0-9X]/g, "");
  return (display.match(/.{1,4}/g) ?? [display]).join(" ");
}

/**
 * Masks a 16-digit PAN while it is already in request memory.
 *
 * `null` for every other shape is intentional: the four-digit re-entry model
 * cannot faithfully reconstruct a 17–19 digit card.
 */
export function maskCardPan(pan: string): string | null {
  const digits = cardDigits(pan);
  return digits.length === 16 ? `${digits.slice(0, 8)}XXXX${digits.slice(-4)}` : null;
}

/** Formats transient expiry input as MM/YY, capped to the contract's four digits. */
export function formatCardExpiryInput(value: string): string {
  const digits = cardDigits(value).slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

/** Validates MM/YY. A card remains valid for the whole named month. */
export function validateCardExpiry(value: string, now = new Date()): CardExpiryValidation {
  const digits = cardDigits(value);
  if (digits.length !== 4) return { valid: false, digits, error: "incomplete" };

  const month = Number(digits.slice(0, 2));
  const year = Number(digits.slice(2, 4));
  if (month < 1 || month > 12) return { valid: false, digits, error: "invalid_month" };

  // The Edge validator uses UTC too, so a device and the server cannot disagree
  // for a few hours around midnight on the first day of a month.
  const currentYear = now.getUTCFullYear() % 100;
  const currentMonth = now.getUTCMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return { valid: false, digits, error: "expired" };
  }

  return {
    valid: true,
    digits,
    normalized: `${digits.slice(0, 2)}/${digits.slice(2, 4)}`,
    month,
    year,
  };
}

/** Formats the numeric month/year stored beside a masked card. */
export function formatStoredCardExpiry(month: number, year: number): string {
  const twoDigitYear = Number.isInteger(year) ? ((year % 100) + 100) % 100 : 0;
  return `${String(month).padStart(2, "0")}/${String(twoDigitYear).padStart(2, "0")}`;
}

/** Invalid stored values are unusable and therefore treated as expired. */
export function isStoredCardExpired(month: number, year: number, now = new Date()): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) return true;
  return !validateCardExpiry(formatStoredCardExpiry(month, year), now).valid;
}

export function isPartialCardDisplayPan(value: string): boolean {
  return /^[0-9]{8}XXXX[0-9]{4}$/.test(value);
}

/**
 * Reassembles a full PAN only after the buyer supplies the missing four digits.
 * The result should be held only long enough to invoke the payment provider.
 */
export function reconstructPartialCardPan(displayPan: string, missingDigits: string): string | null {
  const missing = cardDigits(missingDigits);
  if (!isPartialCardDisplayPan(displayPan) || missing.length !== 4) return null;
  return `${displayPan.slice(0, 8)}${missing}${displayPan.slice(-4)}`;
}
