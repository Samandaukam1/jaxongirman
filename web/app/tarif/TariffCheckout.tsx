"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createSubscriptionOrder, OrderPaymentError, payStart, payVerify,
  subscriptionPlans, type OrderSummary, type Plan,
} from "@/lib/orders";
import { supabase } from "@/lib/supabase";

type Step = "plans" | "card" | "code" | "done";

function som(value: number): string {
  return `${value.toLocaleString("uz-UZ")} so‘m`;
}

function groupDigits(value: string): string {
  return (value.match(/.{1,4}/g) ?? [value]).join(" ");
}

/**
 * Buying a tariff on the web.
 *
 * The same order engine the apps use, called the same way — there is no
 * web-specific payment logic, so a price or a commission cannot drift between
 * platforms. What differs is only the surface: a browser needs a sign-in prompt
 * and has no camera, nothing else.
 *
 * The card number lives in this component's state for exactly one request and is
 * cleared the moment the provider has been handed it. It is never put in a URL,
 * never in localStorage, and never returned — what comes back for the
 * confirmation line is what Payme already masked.
 */
export function TariffCheckout() {
  const [step, setStep] = useState<Step>("plans");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const [pan, setPan] = useState("");
  const [expiry, setExpiry] = useState("");
  const [code, setCode] = useState("");
  const [maskedCard, setMaskedCard] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    const { data: session } = await supabase.auth.getSession();
    setSignedIn(Boolean(session.session));
    try {
      setPlans((await subscriptionPlans()).plans);
    } catch {
      setError("Tariflar yuklanmadi.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const panDigits = pan.replace(/\D/g, "");
  const expiryDigits = expiry.replace(/\D/g, "");

  async function choose(plan: Plan) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      setOrder(await createSubscriptionOrder(plan.code));
      setStep("card");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Buyurtma ochilmadi.");
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  async function submitCard() {
    if (submitting.current || !order) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const started = await payStart(order.order_id, panDigits, expiry);
      setMaskedCard(started.maskedCard);
      setSandbox(started.sandbox);
      setStep("code");
      // Handed over. It has no further use here.
      setPan("");
      setExpiry("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "To‘lov boshlanmadi.");
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  async function submitCode() {
    if (submitting.current || !order) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await payVerify(order.order_id, code);
      if (result.status !== "paid") throw new Error("To‘lov tasdiqlanmadi.");
      setStep("done");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "To‘lov amalga oshmadi.");
      setCode("");
      if (failure instanceof OrderPaymentError && !failure.recoverable) setStep("plans");
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
                  {plans.map((plan) => (
                    <button
                      key={plan.code}
                      className="plan-option"
                      type="button"
                      disabled={busy}
                      onClick={() => void choose(plan)}
                    >
                      <span className="plan-name">{plan.label}</span>
                      <span className="plan-meta">{plan.duration_months} oy</span>
                      <span className="plan-price">{som(plan.price_amount)}</span>
                    </button>
                  ))}
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
              <label className="checkout-field">
                Karta raqami
                <input
                  value={groupDigits(panDigits)}
                  onChange={(event) => setPan(event.target.value.replace(/\D/g, "").slice(0, 19))}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="8600 0000 0000 0000"
                />
              </label>
              <label className="checkout-field">
                Amal qilish muddati
                <input
                  value={expiryDigits.length > 2 ? `${expiryDigits.slice(0, 2)}/${expiryDigits.slice(2)}` : expiryDigits}
                  onChange={(event) => setExpiry(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  placeholder="MM/YY"
                />
              </label>
              <p className="store-note">
                Karta raqami to&lsquo;lov tizimiga to&lsquo;g&lsquo;ridan-to&lsquo;g&lsquo;ri uzatiladi va
                Jaxongirman serverida saqlanmaydi.
              </p>
              <button
                className="store-button"
                type="button"
                disabled={busy || panDigits.length < 16 || expiryDigits.length !== 4}
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
              <button className="store-button" type="button" disabled={busy || code.length < 4} onClick={() => void submitCode()}>
                {busy ? "Tasdiqlanmoqda…" : "TASDIQLASH"}
              </button>
              <button className="store-button ghost" type="button" onClick={() => { setStep("card"); setCode(""); setError(null); }}>
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
