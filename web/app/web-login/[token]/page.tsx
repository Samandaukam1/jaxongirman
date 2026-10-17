import type { Metadata } from "next";

import { STORE_ANDROID, STORE_IOS } from "@/lib/stores";

export const metadata: Metadata = {
  title: "Saytga kirish — Jaxongirman",
  robots: { index: false, follow: false },
};

/**
 * `/web-login/<token>` — the link inside the sign-in QR.
 *
 * On a phone with the app the OS never shows this page: the association opens
 * the app straight on the confirmation. Everybody else lands here and is told
 * what the code is for and where it is confirmed. Nothing is signed in from a
 * browser: letting a computer in is the app's to decide.
 */
export default async function WebLoginLanding({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const safe = /^[0-9a-f]{36}$/i.test(token) ? token.toLowerCase() : null;
  return (
    <main className="pair-page">
      <div className="hero-orb one" aria-hidden />
      <div className="shell scan-landing">
        <p className="eyebrow">SAYTGA KIRISH</p>
        <h1>Bu kod kompyuterda hisobingizni ochadi</h1>
        <p className="scan-lead">
          Uni Jaxongirman ilovasida tasdiqlaysiz: <strong>Profil</strong> → <strong>Web ulash</strong> bo&lsquo;limida kodni skaner qiling.
          Ilova o&lsquo;rnatilgan bo&lsquo;lsa, quyidagi tugma uni shu kod bilan ochadi.
        </p>
        <div className="account-actions">
          {safe ? <a className="store-button" href={`jaxongirman://web-login/${safe}`}>Ilovada ochish</a> : null}
          <a className="store-button ghost" href={STORE_IOS}>App Store</a>
          <a className="store-button ghost" href={STORE_ANDROID}>Google Play</a>
        </div>
      </div>
    </main>
  );
}
