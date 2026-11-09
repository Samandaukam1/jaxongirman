import { Laptop } from "lucide-react";

import { AppleLogo, GooglePlayLogo } from "@/app/_brand/StoreLogos";
import { STORE_ANDROID, STORE_IOS } from "@/lib/stores";

import "./phone-notice.css";

/**
 * What a phone sees at `/taqdimot`.
 *
 * The presenting screen is the projector's half of the pair: it shows a code
 * for the phone to scan, so on the phone itself there is nothing to scan it
 * with. Rather than open a session nobody can join, the phone is told where
 * presenting happens and is given the app, which is where its half lives.
 *
 * The store for this phone comes first; the other stays, for somebody reading
 * on one phone and installing on another.
 */
export function PhoneNotice({ android }: { android: boolean }) {
  const apple = (
    <a key="ios" className="tq-phone-store" href={STORE_IOS}>
      <AppleLogo />
      <span><small>Yuklab oling</small>App Store</span>
    </a>
  );
  const google = (
    <a key="android" className="tq-phone-store" href={STORE_ANDROID}>
      <GooglePlayLogo />
      <span><small>Yuklab oling</small>Google Play</span>
    </a>
  );

  return (
    <main className="notice-page tq-phone">
      <div className="hero-orb one" aria-hidden />
      <div className="hero-orb two" aria-hidden />
      <div className="shell">
        <div className="notice-card tq-phone-card">
          <span className="tq-phone-icon" aria-hidden><Laptop /></span>
          <p className="eyebrow">Taqdimot qilish</p>
          <h1>Faqat kompyuterda ishlaydi</h1>
          <p>
            Taqdimot qilish mobil versiyada ishlamaydi, faqat desktop versiyada ishlaydi. Shu sahifani
            kompyuter yoki noutbukda oching — telefoningiz esa pult bo‘ladi.
          </p>
          <hr className="tq-phone-rule" />
          <p className="tq-phone-cta">Hisobga kirish uchun ilovani yuklab oling</p>
          <div className="tq-phone-stores">{android ? [google, apple] : [apple, google]}</div>
          <a className="tq-phone-home" href="/">Bosh sahifaga qaytish</a>
        </div>
      </div>
    </main>
  );
}
