"use client";

import { cardLines, detailSections, priceLine } from "@jaxongirman/tariff-card";
import { Check } from "lucide-react";

import {
  cardDigits,
  formatCardExpiryInput,
  formatCardPan,
  formatStoredCardExpiry,
  isStoredCardExpired,
  reconstructPartialCardPan,
  validateCardExpiry,
  type CardExpiryError,
} from "@jaxongirman/types";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createSubscriptionOrder, listPartialCards, OrderPaymentError, payStart, payVerify,
  subscriptionPlans, type OrderSummary, type PartialCard, type Plan,
} from "@/lib/orders";
import { supabase } from "@/lib/supabase";

type Step = "plans" | "card" | "code" | "done";

function som(value: number): string {
  return `${value.toLocaleString("uz-UZ")} so‘m`;
}

function expiryError(error: CardExpiryError): string {
  if (error === "invalid_month") return "Oy 01 dan 12 gacha bo‘lishi kerak.";
  if (error === "expired") return "Kartaning amal qilish muddati tugagan.";
  return "Amal qilish muddatini MM/YY ko‘rinishida kiriting.";
}

const OTP_RESTART_CODES = new Set([
  "invalid_code", "not_verified", "code_expired",
  "attempt_not_found", "attempt_expired", "attempt_consumed",
]);

/**
 * Buying a tariff on the web.
 *
 * The same order engine the apps use, called the same way — there is no
 * web-specific payment logic, so a price or a commission cannot drift between
 * platforms. What differs is only the surface: a browser needs a sign-in prompt
 * and has no camera, nothing else.
 *
 * A newly typed card lives only in this component's transient state. A partial
 * card is reconstructed in a local variable for `payStart`; both paths clear
 * their sensitive digits as soon as the request begins. Nothing goes into a URL
 * or localStorage, and the confirmation line receives only a masked hint.
 */
export function TariffCheckout() {
  const [step, setStep] = useState<Step>("plans");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [cards, setCards] = useState<PartialCard[]>([]);
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const [pan, setPan] = useState("");
  const [expiry, setExpiry] = useState("");
  const [selectedCard, setSelectedCard] = useState<PartialCard | null>(null);
  const [missingDigits, setMissingDigits] = useState("");
  const [code, setCode] = useState("");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [maskedCard, setMaskedCard] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    const { data: session, error: sessionError } = await supabase.auth.getSession();
    const hasSession = Boolean(session.session) && !sessionError;
    setSignedIn(hasSession);
    try {
      const [catalogue, savedCards] = await Promise.all([
        subscriptionPlans(),
        hasSession ? listPartialCards() : Promise.resolve([]),
      ]);
      setPlans(catalogue.plans);
      setCards(savedCards);
    } catch {
      setError("Tariflar yoki chala kartalar yuklanmadi.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const panDigits = cardDigits(pan);
  const missingCardDigits = cardDigits(missingDigits);
  const expiryValidation = validateCardExpiry(expiry);
  const selectedCardExpired = selectedCard
    ? isStoredCardExpired(selectedCard.expiry_month, selectedCard.expiry_year)
    : false;
  const cardReady = selectedCard
    ? missingCardDigits.length === 4 && !selectedCardExpired
    : panDigits.length === 16 && expiryValidation.valid;
  const panProblem = panDigits.length > 0 && panDigits.length !== 16
    ? "Karta raqami 16 ta raqamdan iborat bo‘lishi kerak."
    : null;
  const expiryProblem = expiry.length > 0 && !expiryValidation.valid
    ? expiryError(expiryValidation.error)
    : null;

  /** Selecting a hint only changes local presentation; it never starts payment. */
  function selectPartialCard(card: PartialCard) {
    setSelectedCard(card);
    setPan("");
    setExpiry("");
    setMissingDigits("");
    setError(null);
  }

  function selectNewCard() {
    setSelectedCard(null);
    setPan("");
    setExpiry("");
    setMissingDigits("");
    setError(null);
  }

  async function choose(plan: Plan) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      setOrder(await createSubscriptionOrder(plan.code));
      selectNewCard();
      setStep("card");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Buyurtma ochilmadi.");
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  async function submitCard() {
    if (submitting.current || !order || !cardReady) return;

    // A selected hint becomes a PAN only here, after the four missing digits
    // were entered. It is a local for this one request and is never state.
    const paymentPan = selectedCard
      ? reconstructPartialCardPan(selectedCard.display_pan, missingCardDigits)
      : panDigits;
    const paymentExpiry = selectedCard
      ? formatStoredCardExpiry(selectedCard.expiry_month, selectedCard.expiry_year)
      : expiryValidation.valid ? expiryValidation.normalized : "";
    if (!paymentPan || paymentPan.length !== 16 || !validateCardExpiry(paymentExpiry).valid) return;

    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const request = payStart(order.order_id, paymentPan, paymentExpiry);
      // The request owns the transient digits now. Remove them from the DOM and
      // React state immediately, on success or failure.
      setPan("");
      setExpiry("");
      setMissingDigits("");

      const started = await request;
      if (!started.attemptId) throw new Error("To‘lov urinishi ochilmadi.");
      setAttemptId(started.attemptId);
      setMaskedCard(started.maskedCard);
      setSandbox(started.sandbox);
      setStep("code");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "To‘lov boshlanmadi.");
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  async function submitCode() {
    if (submitting.current || !order || !attemptId) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const verifyRequest = payVerify(order.order_id, attemptId, code);
      // The verification code is request-local too; do not retain it in React
      // state while the provider response is in flight.
      setCode("");
      const result = await verifyRequest;
      if (result.status !== "paid") throw new Error("To‘lov tasdiqlanmadi.");
      setAttemptId(null);
      setStep("done");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "To‘lov amalga oshmadi.");
      setCode("");
      if (failure instanceof OrderPaymentError) {
        if (failure.restartRequired || OTP_RESTART_CODES.has(failure.code)) {
          // The provider token is single-use. A fresh card start is what requests
          // the next SMS; retrying this code against a consumed token cannot work.
          setMissingDigits("");
          setAttemptId(null);
          setStep("card");
        } else if (!failure.recoverable) {
          setAttemptId(null);
          setStep("plans");
        }
      }
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  if (signedIn === false) {
    return (
      <main className="notice-page">
        <div className="shell"><div className="notice-card">
          <div className="glyph" style={{ margin: "0 auto" }}>◎</div>
          <h1>Hisobingizga kiring</h1>
          <p>Tarif hisobingizga bog‘lanadi, shuning uchun to‘lovdan oldin kirish kerak.</p>
          <div className="store-row"><a className="store-button ghost" href="/">Bosh sahifa</a></div>
        </div></div>
      </main>
    );
  }

  if (step === "done" && order) {
    return (
      <main className="notice-page">
        <div className="shell"><div className="notice-card">
          <div className="glyph" style={{ margin: "0 auto" }}>✓</div>
          <h1>To&lsquo;lov muvaffaqiyatli</h1>
          <p>
            Buyurtma <strong>{order.order_number}</strong> — {som(order.total_amount)}.
            {maskedCard ? ` ${maskedCard}` : ""}
          </p>
          <p className="store-note">Tarif hisobingizda faollashtirildi. Ilovada darhol ko&lsquo;rinadi.</p>
          <div className="store-row"><a className="store-button" href="/">Bosh sahifa</a></div>
        </div></div>
      </main>
    );
  }

  return (
    <main className="notice-page">
      <div className="shell">
        <div className="notice-card checkout-card">
          <p className="eyebrow">TARIF</p>

          {step === "plans" ? (
            <>
              <h1>Tarifni tanlang</h1>
              {plans.length === 0 ? (
                <p>Hozircha sotuvda tarif yo&lsquo;q. Keyinroq qayta urinib ko&lsquo;ring.</p>
              ) : (
                <div className="plan-list">
                  {plans.map((plan) => {
                    // Drawn from the same package the console previews with, so
                    // what an admin approved is what is shown here.
                    const shaped = {
                      code: plan.code, name: plan.name, subtitle: plan.subtitle,
                      description: "", badge: plan.badge, ctaLabel: plan.cta_label,
                      priceAmount: plan.price_amount, compareAtAmount: plan.compare_at_amount,
                      currency: plan.currency, periodDays: plan.period_days,
                      features: plan.features,
                    };
                    const price = priceLine(shaped);
                    return (
                      <article key={plan.code} className="tariff-card">
                        {plan.badge ? <span className="tariff-card-badge">{plan.badge}</span> : null}
                        <h2>{plan.name}</h2>
                        <p className="tariff-card-price">
                          <strong>{price.amount}</strong>
                          <span>{price.unit}</span>
                        </p>
                        {plan.subtitle ? <p className="tariff-card-subtitle">{plan.subtitle}</p> : null}

                        <ul className="tariff-card-lines">
                          {cardLines(shaped).map((line) => (
                            <li key={line.key}><Check size={15} strokeWidth={2.4} aria-hidden /> {line.label}</li>
                          ))}
                        </ul>

                        <button
                          className="tariff-card-cta"
                          type="button"
                          disabled={busy}
                          onClick={() => void choose(plan)}
                        >
                          {plan.cta_label || `${price.amount} so‘mga boshlash`}
                        </button>

                        <details className="tariff-detail">
                          <summary>Barcha imkoniyatlarni ko‘rish</summary>
                          {detailSections(shaped).map((section) => (
                            <section key={section.key}>
                              <h3>{section.title}</h3>
                              <dl>
                                {section.rows.map((row) => (
                                  <div key={row.label} className={row.included ? undefined : "is-absent"}>
                                    <dt>{row.label}</dt><dd>{row.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </section>
                          ))}
                        </details>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          ) : null}

          {step === "card" && order ? (
            <>
              <h1>To&lsquo;lov</h1>
              <p className="checkout-total">
                {order.order_number} · <strong>{som(order.total_amount)}</strong>
              </p>
              <div className="checkout-field">
                <span>Karta raqami</span>
                {selectedCard ? (
                  <div
                    className="checkout-masked-pan"
                    role="group"
                    aria-label={`${formatCardPan(selectedCard.display_pan)} kartaning yetishmayotgan raqamlari`}
                  >
                    <span>{formatCardPan(selectedCard.display_pan.slice(0, 8))}</span>
                    <input
                      className="checkout-missing-digits"
                      value={missingCardDigits}
                      onChange={(event) => setMissingDigits(cardDigits(event.target.value).slice(0, 4))}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={4}
                      placeholder="XXXX"
                      aria-label="Yetishmayotgan to‘rt raqam"
                      autoFocus
                    />
                    <span>{selectedCard.last4}</span>
                  </div>
                ) : (
                  <input
                    value={formatCardPan(panDigits)}
                    onChange={(event) => setPan(cardDigits(event.target.value).slice(0, 16))}
                    inputMode="numeric"
                    autoComplete="cc-number"
                    maxLength={19}
                    placeholder="8600 0000 0000 0000"
                    aria-invalid={Boolean(panProblem)}
                  />
                )}
                {selectedCard ? (
                  <small className="checkout-help">Yetishmayotgan 4 ta raqamni kiriting</small>
                ) : panProblem ? (
                  <small className="checkout-field-error">{panProblem}</small>
                ) : null}
              </div>

              {cards.length > 0 ? (
                <fieldset className="partial-card-picker">
                  <legend>Chala kartalardan</legend>
                  <div className="partial-card-list">
                    {cards.map((card) => {
                      const active = selectedCard?.id === card.id;
                      const expired = isStoredCardExpired(card.expiry_month, card.expiry_year);
                      return (
                        <button
                          key={card.id}
                          className={`partial-card-option${active ? " is-active" : ""}`}
                          type="button"
                          disabled={busy || expired}
                          aria-pressed={active}
                          onClick={() => selectPartialCard(card)}
                        >
                          <span className="partial-card-pan">{formatCardPan(card.display_pan)}</span>
                          <span className="partial-card-expiry">
                            {formatStoredCardExpiry(card.expiry_month, card.expiry_year)}
                            {expired ? " · muddati tugagan" : ""}
                          </span>
                        </button>
                      );
                    })}
                    <button
                      className={`partial-card-option partial-card-new${selectedCard === null ? " is-active" : ""}`}
                      type="button"
                      disabled={busy}
                      aria-pressed={selectedCard === null}
                      onClick={selectNewCard}
                    >
                      <span className="partial-card-pan">Yangi karta</span>
                      <span className="partial-card-expiry">16 ta raqamni kiriting</span>
                    </button>
                  </div>
                </fieldset>
              ) : null}

              <div className="checkout-field">
                <span>Amal qilish muddati</span>
                {selectedCard ? (
                  <output className="checkout-readonly-expiry">
                    {formatStoredCardExpiry(selectedCard.expiry_month, selectedCard.expiry_year)}
                  </output>
                ) : (
                  <input
                    value={expiry}
                    onChange={(event) => setExpiry(formatCardExpiryInput(event.target.value))}
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    maxLength={5}
                    placeholder="MM/YY"
                    aria-invalid={Boolean(expiryProblem)}
                  />
                )}
                {selectedCardExpired ? (
                  <small className="checkout-field-error">Kartaning amal qilish muddati tugagan.</small>
                ) : expiryProblem ? (
                  <small className="checkout-field-error">{expiryProblem}</small>
                ) : null}
              </div>
              <p className="store-note">
                Karta raqami to&lsquo;lov tizimiga to&lsquo;g&lsquo;ridan-to&lsquo;g&lsquo;ri uzatiladi va
                Jaxongirman serverida saqlanmaydi.
              </p>
              <p className="checkout-provider">Powered by <strong>Payme</strong></p>
              <button
                className="store-button"
                type="button"
                disabled={busy || !cardReady}
                onClick={() => void submitCard()}
              >
                {busy ? "TO‘LOV AMALGA OSHIRILMOQDA…" : `${som(order.total_amount)} to‘lash`}
              </button>
            </>
          ) : null}

          {step === "code" && order ? (
            <>
              <h1>Tasdiqlash</h1>
              <p>{maskedCard ? `${maskedCard} — ` : ""}kartaga bog&lsquo;langan raqamga SMS yuborildi.</p>
              <label className="checkout-field">
                Tasdiqlash kodi
                <input
                  className="checkout-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  placeholder="——————"
                  autoFocus
                />
              </label>
              {sandbox ? <p className="store-note">Sinov rejimi: kod 111111.</p> : null}
              <button
                className="store-button"
                type="button"
                disabled={busy || !attemptId || code.length < 4}
                onClick={() => void submitCode()}
              >
                {busy ? "Tasdiqlanmoqda…" : "TASDIQLASH"}
              </button>
              <button
                className="store-button ghost"
                type="button"
                onClick={() => {
                  setStep("card");
                  setAttemptId(null);
                  setCode("");
                  setMissingDigits("");
                  setError(null);
                }}
              >
                Kartani qayta kiritish
              </button>
            </>
          ) : null}

          {error ? <p className="checkout-error">{error}</p> : null}
        </div>
      </div>
    </main>
  );
}
