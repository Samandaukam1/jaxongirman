import { i18n } from "../i18n";
import type errors from "../i18n/ns/errors";

type ErrorKey = Extract<keyof (typeof errors)["uz"], string>;
type Match = { key: ErrorKey; values?: Record<string, string | number> };

/** Edge-function codes that always mean the same thing, whatever the sentence beside them. */
const CODES: Record<string, ErrorKey> = {
  web_link_failed: "webLinkFailed",
  web_no_email: "webNoEmail",
  web_token_expired: "webTokenExpired",
  web_token_invalid: "webTokenInvalid",
  web_token_missing: "webTokenMissing",
  web_token_used: "webTokenUsed",
  account_blocked: "accountBlocked",
  already_listed: "alreadyListed",
  attempt_in_progress: "attemptActive",
  attempt_not_found: "attemptMissing",
  card_expired: "cardExpired",
  cyrillic_topic: "cyrillicTopic",
  empty_deck: "emptyDeck",
  forbidden: "forbidden",
  in_use: "inUse",
  insufficient_credits: "insufficientCoins",
  invalid_code: "codeRequired",
  invalid_expiry: "cardExpiry",
  invalid_json: "invalidRequest",
  invalid_language: "invalidLanguage",
  invalid_pan: "cardNumber",
  invalid_request: "invalidRequest",
  invalid_slide_count: "slideCount",
  invalid_topic: "topicLength",
  ios_payments_disabled: "iosPayments",
  listed_in_shop: "listedInShop",
  missing_topic: "topicLength",
  not_found: "notFound",
  not_owner: "forbidden",
  not_ready: "notReady",
  order_closed: "orderClosed",
  order_expired: "orderExpired",
  payload_too_large: "tooLarge",
  presentation_missing: "notFound",
  presentation_not_found: "notFound",
  presentation_too_thin: "deckTooThin",
  provider_not_configured: "providerUnavailable",
  provider_unavailable: "providerUnavailable",
  rate_limited: "rateLimited",
  rights_not_confirmed: "rightsNotConfirmed",
  still_generating: "stillGenerating",
  topic_too_long: "topicLength",
  unauthorized: "authRequired",
};

/** Database refusals, by their exact wording. */
const MESSAGES: Record<string, ErrorKey> = {
  "authentication required": "authRequired",
  "account is blocked": "accountBlocked",
  "account cannot send coins": "accountBlocked",
  "insufficient credits": "insufficientCoins",
  "insufficient balance": "insufficientCoins",
  "you cannot send coins to yourself": "sendToSelf",
  "recipient not found": "recipientNotFound",
  "recipient cannot receive coins": "recipientBlocked",
  "unsupported presentation language": "invalidLanguage",
  "valid presentation id and topic are required": "topicLength",
  "slide count out of range": "slideCount",
  "ready presentation not found": "notFound",
  "presentation not found": "notFound",
  "too many active export jobs": "tooManyExports",
  "survey is not open": "surveyClosed",
  "Mavzuni lotin yozuvida kiriting.": "cyrillicTopic",
  "Bu tilda o‘yin yaratish hozircha o‘chirilgan.": "gameLanguageDisabled",
  "Bepul taqdimot maksimum 10 sahifali bo‘lishi mumkin.": "freeDeckMax",
  "Bu tilda taqdimot yaratish hozircha o‘chirilgan.": "languageDisabled",
  "Bu paket sotuvda emas.": "packageUnavailable",
  "Bu paket hozir sotuvda emas.": "packageUnavailable",
  "Bunday tarif sotuvda emas.": "planUnavailable",
  "To‘lov urinishi topilmadi. Qaytadan boshlang.": "attemptMissing",
  "To‘lov urinishi muddati tugadi. Qaytadan boshlang.": "attemptExpired",
  "Sarlavha 3–160 belgi bo‘lsin.": "listingTitle",
  "Mahsulot sotuvda emas.": "productUnavailable",
  "O‘z mahsulotingizni sotib ololmaysiz.": "ownProduct",
  "Bu mahsulot allaqachon sizda bor.": "alreadyOwned",
  "Xaridni tasdiqlash uchun qaytarish shartlariga rozilik bering.": "refundTerms",
  "Do‘kondan foydalanish uchun tarifni faollashtiring.": "storeNeedsPlan",
  "Do‘konda sotish uchun tarifni faollashtiring.": "storeSellNeedsPlan",
  "Tarifingizda bu amal mavjud emas.": "planFeature",
  "O‘yin topilmadi. QR kodni qayta skaner qiling.": "gameNotFound",
  "Bu o‘yin yakunlangan.": "gameFinished",
  "O‘yin allaqachon yakunlangan.": "gameFinished",
  "Ismingizni yozing.": "gameNameRequired",
  "Bunday kodli o‘yin topilmadi.": "gameCodeNotFound",
  "QR kod eskirgan. Ekrandagi yangi kodni skaner qiling.": "qrExpired",
  "Sessiya muddati tugagan.": "sessionExpired",
  "Vaqt tugadi.": "timeUp",
  "Bu savol yopilgan.": "questionClosed",
  "So‘rovnoma yopilgan.": "surveyClosed",
  "So‘rovnoma muddati tugagan.": "surveyExpired",
  "Rasm hajmi 3 MB dan kichik bo‘lishi kerak.": "imageTooLarge",
  "Juda ko‘p urinish. Bir daqiqadan so‘ng qayta urinib ko‘ring.": "rateLimited",
  "Bitta xabarga ko‘pi bilan 5 ta fayl biriktiriladi.": "supportFiles",
  "Bir kunda ko‘pi bilan 5 ta murojaat yuborish mumkin.": "supportDaily",
  "Sizda 10 ta ochiq murojaat bor. Avvalgilariga javobni kuting.": "supportOpen",
  "Bu murojaat yopilgan. Yangi murojaat yuboring.": "supportClosed",
  "Murojaat 30 kundan oldin hal qilingan. Yangi murojaat yuboring.": "supportTooOld",
  "Faqat hal qilingan murojaatni qayta ochish mumkin.": "supportReopen",
  "Murojaat topilmadi.": "supportNotFound",
  "Fayl topilmadi: qayta yuklang.": "supportFileMissing",
  "Bu raqamli buyurtma sizning hisobingizda topilmadi.": "supportOrder",
  "Bu taqdimot sizniki emas.": "supportDeck",
  "Juda ko‘p xabar yuborildi. Birozdan keyin urinib ko‘ring.": "tooManyMessages",
};

/** Database refusals that carry a figure. */
const PATTERNS: readonly [RegExp, (found: RegExpMatchArray) => Match][] = [
  [/^Narx yangilandi: bu taqdimot (\d+) J Tanga/, (found) => ({ key: "priceChanged", values: { coins: Number(found[1]) } })],
  [/^Tarifingizda bitta prezentatsiya uchun eng ko['‘’]pi (\d+) ta slayd/, (found) => ({ key: "planSlides", values: { count: Number(found[1]) } })],
  [/prezentatsiya limiti tugadi/, () => ({ key: "planLimit" })],
  [/^Tarif J Tangalarini .*O‘tkazish mumkin: (\d+) J/, (found) => ({ key: "planCoinsTransfer", values: { coins: Number(found[1]) } })],
  [/^Bu paketni ko‘pi bilan (\d+) marta/, (found) => ({ key: "packageLimit", values: { count: Number(found[1]) } })],
  [/^Narx .* so‘m oralig‘ida bo‘lsin/, () => ({ key: "listingPrice" })],
  [/^Sahifalar soni .* bo‘lishi kerak/, () => ({ key: "slideCount" })],
];

const NETWORK = /network request failed|failed to fetch|FunctionsFetchError|load failed|timed? ?out/i;
const TRANSPORT = /non-2xx status code|FunctionsHttpError|FunctionsRelayError/i;
/**
 * Older server messages are English — lower-case database sentences
 * ("insufficient credits") or the functions' own — and an Uzbek reader is
 * better served by the table.
 */
const ENGLISH = /\b(the|is|are|not|required|must|invalid|found|only|cannot|may|too|already|unavailable|configured)\b/i;
const LOWER_ASCII = /^[a-z][a-z0-9 ,.'_-]*$/;

function match(message: string, code: string | undefined): Match | null {
  if (code && CODES[code]) return { key: CODES[code] };
  const exact = MESSAGES[message] ?? MESSAGES[message.toLowerCase()];
  if (exact) return { key: exact };
  for (const [pattern, read] of PATTERNS) {
    const found = message.match(pattern);
    if (found) return read(found);
  }
  return null;
}

/**
 * A server refusal said in the app's language.
 *
 * Uzbek readers keep the server's own sentence when it is Uzbek — it is often
 * more particular than the table ("Taqdimot topilmadi." over "Topilmadi").
 * Everyone else gets the table's sentence for any refusal it knows. A refusal
 * it does not know is shown as written.
 */
export function localizeError(message: string | null | undefined, code?: string): string {
  const text = (message ?? "").trim();
  if (NETWORK.test(text)) return i18n.t("errors:network");
  if (!text || TRANSPORT.test(text)) return i18n.t("errors:unexpected");
  if (i18n.language === "uz" && !ENGLISH.test(text) && !LOWER_ASCII.test(text)) return text;
  const found = match(text, code);
  return found ? i18n.t(`errors:${found.key}`, found.values ?? {}) : text;
}
