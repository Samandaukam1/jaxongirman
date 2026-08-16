import { HttpError } from "./http.ts";

export type ParsedPaymentCard = {
  /** Digits only. This value must stay in request memory and go only to Payme. */
  pan: string;
  /** Safe storage/display value. It cannot be used without four new digits. */
  displayPan: string;
  expiryMonth: number;
  expiryYear: number;
  expiryHint: string;
  /** Payme cards.create expects MMYY. */
  providerExpiry: string;
};

/**
 * Validates and immediately masks card input before anything is persisted.
 *
 * Uzbekistan's supported card rails use 16-digit PANs, and the product's
 * partial-card contract hides exactly four digits. Accepting a 17–19 digit PAN
 * would produce a hint that can never reconstruct the card it describes.
 */
export function parsePaymentCard(
  panInput: string,
  expiryInput: string,
  now = new Date(),
): ParsedPaymentCard {
  const rawPan = panInput.trim();
  if (!/^[0-9 -]+$/.test(rawPan)) {
    throw new HttpError(400, "Karta raqamini to‘liq kiriting.", "invalid_pan");
  }
  const pan = rawPan.replace(/[ -]/g, "");
  if (!/^[0-9]{16}$/.test(pan)) {
    throw new HttpError(400, "Karta raqami 16 ta raqamdan iborat bo‘lishi kerak.", "invalid_pan");
  }

  const expiry = expiryInput.trim();
  const match = /^(0[1-9]|1[0-2])\/([0-9]{2})$/.exec(expiry);
  if (!match) {
    throw new HttpError(400, "Amal qilish muddatini MM/YY ko‘rinishida kiriting.", "invalid_expiry");
  }

  const expiryMonth = Number(match[1]);
  const expiryYear = Number(match[2]);
  const fullYear = 2000 + expiryYear;
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (fullYear < currentYear || (fullYear === currentYear && expiryMonth < currentMonth)) {
    throw new HttpError(400, "Kartaning amal qilish muddati tugagan.", "card_expired");
  }

  return {
    pan,
    displayPan: `${pan.slice(0, 8)}XXXX${pan.slice(-4)}`,
    expiryMonth,
    expiryYear,
    expiryHint: `${match[1]}/${match[2]}`,
    // Payme Subscribe API cards.create documents `expire` as MMYY.
    providerExpiry: `${match[1]}${match[2]}`,
  };
}

/**
 * Confirms that provider metadata describes the same card as our in-memory
 * hint. Payme normally returns six visible leading digits and four trailing
 * digits; the product hint deliberately keeps eight leading digits. We compare
 * every digit the provider chose to reveal and never attempt to unmask either.
 */
export function providerMaskMatches(
  providerMasked: string | null | undefined,
  displayPan: string,
): boolean {
  if (providerMasked == null || providerMasked.trim() === "") return true;
  if (!/^[0-9]{8}XXXX[0-9]{4}$/.test(displayPan)) return false;

  const compact = providerMasked.replace(/[\s-]/g, "");
  const match = /^([0-9]{4,12})[*Xx•]+([0-9]{4})$/.exec(compact);
  if (!match) return false;
  return displayPan.startsWith(match[1]) && displayPan.endsWith(match[2]);
}

