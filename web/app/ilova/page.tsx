import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";

import { AppleLogo, GooglePlayLogo } from "@/app/_brand/StoreLogos";
import { loadBranding } from "@/lib/branding";
import { APP_LINK, STORE_ANDROID, STORE_IOS, storeFor } from "@/lib/stores";

import { TabletHandoff } from "./TabletHandoff";

import "./ilova.css";

const TITLE = "Jaxongirman ilovasini yuklab oling";
const DESCRIPTION = "AI taqdimot, O‘yingoh va hujjatlar — barchasi bitta ilovada. iPhone va Android uchun bepul.";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await loadBranding();
  return {
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url: APP_LINK,
      siteName: "Jaxongirman",
      locale: "uz_UZ",
      type: "website",
      images: [{ url: brand.social, width: 1200, height: 630, alt: "Jaxongirman" }],
    },
    twitter: { card: "summary_large_image", images: [brand.social] },
  };
}

/** Per request: the answer depends on who is asking. */
export const dynamic = "force-dynamic";

/**
 * `/ilova` — the one link to hand somebody.
 *
 * A phone never sees this page: it is sent on to the store it uses, before
 * anything is drawn. Everything else stays here. That is a computer, which
 * cannot install the app and is shown a code for the phone beside it, and a
 * link-preview bot, which reads the title and picture off this page and so has
 * to be answered rather than redirected.
 */
export default async function AppLinkPage() {
  const store = storeFor((await headers()).get("user-agent") ?? "");
  if (store) redirect(store);

  const qr = await QRCode.toDataURL(APP_LINK, { errorCorrectionLevel: "M", margin: 1, width: 520 });

  return (
    <main className="pair-page">
      <TabletHandoff />
      <div className="hero-orb one" aria-hidden />
      <div className="hero-orb two" aria-hidden />
      <div className="shell pair-shell">
        <div className="pair-copy">
          <p className="eyebrow">JAXONGIRMAN ILOVASI</p>
          <h1>Ilovani telefoningizga yuklab oling</h1>
          <p className="ilova-lead">
            Telefon kamerasini QR kodga qarating: iPhone App Store’ni, Android esa Google Play’ni o‘zi ochadi.
          </p>
          <div className="ilova-stores">
            <a className="ilova-store" href={STORE_IOS}>
              <AppleLogo />
              <span><small>Yuklab oling</small>App Store</span>
            </a>
            <a className="ilova-store" href={STORE_ANDROID}>
              <GooglePlayLogo />
              <span><small>Yuklab oling</small>Google Play</span>
            </a>
          </div>
        </div>
        <div className="pair-qr">
          <img src={qr} alt="Ilovani yuklab olish uchun QR kod" width={320} height={320} />
        </div>
      </div>
    </main>
  );
}
