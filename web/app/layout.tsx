import type { Metadata } from "next";
import { Bricolage_Grotesque, Manrope } from "next/font/google";

import { BrandProvider } from "./_brand/BrandContext";
import { loadBranding } from "@/lib/branding";
import { STORE_ANDROID, STORE_IOS } from "@/lib/stores";

import "./globals.css";

import { HeaderAccount } from "@/app/_account/HeaderAccount";

/**
 * Two faces. Manrope is the app's own, so the site and the phone read as one
 * product; Bricolage Grotesque sets the headlines, where a display cut with
 * real character does what a heavier weight of the text face cannot.
 *
 * The stylesheet used to name "Manrope" without ever loading a file by that
 * name, so every page fell through to the system font — which is why the site
 * read as plain. These are loaded, subset and self-hosted by Next.
 */
const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], variable: "--font-display", display: "swap" });
const text = Manrope({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-text", display: "swap" });

const TITLE = "Jaxongirman — taqdimot, ma'lumot yig'ish va o'quv materiallari";
const DESCRIPTION =
  "Jaxongirman: sun'iy intellekt bilan taqdimot yaratish, so'rovnoma orqali ma'lumot yig'ish va o'quv materiallari do'koni.";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await loadBranding();
  return {
    title: TITLE,
    description: DESCRIPTION,
    metadataBase: new URL("https://jaxongirman.app"),
    icons: { icon: [{ url: brand.favicon }], apple: [{ url: brand.apple }] },
    openGraph: {
      title: "Jaxongirman",
      description: "Taqdimot yarating, ma'lumot yig'ing, materiallaringizni ulashing.",
      url: "https://jaxongirman.app",
      siteName: "Jaxongirman",
      locale: "uz_UZ",
      type: "website",
      images: [{ url: brand.social, width: 1200, height: 630, alt: "Jaxongirman" }],
    },
    twitter: { card: "summary_large_image", images: [brand.social] },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await loadBranding();
  return (
    <html lang="uz" className={`${display.variable} ${text.variable}`}>
      <body>
        <BrandProvider value={brand}>
          <header className="site-header">
            <div className="site-header-bar">
              <a className="brand" href="/">
                {/* The app's own icon, so the site and the phone are recognisably one product. */}
                <img className="brand-logo" src={brand.logo} alt="" width={36} height={36} />
                <span className="brand-name">Jaxongirman</span>
              </a>
              <nav className="nav" aria-label="Asosiy navigatsiya">
                <a href="/#imkoniyatlar">Imkoniyatlar</a>
                <a href="/#dizaynlar">Dizaynlar</a>
                <a href="/tarif">Tarif</a>
                <a href="/dokon">Do&lsquo;kon</a>
              </nav>
              <HeaderAccount />
              <a className="header-cta" href="/taqdimot">
                Taqdimot qilish
                <span aria-hidden>→</span>
              </a>
            </div>
          </header>
          {children}
          <footer className="site-footer">
            <div className="shell footer-grid">
              <div className="footer-brand">
                <a className="brand" href="/">
                  <img className="brand-logo" src={brand.logo} alt="" width={36} height={36} />
                  <span className="brand-name">Jaxongirman</span>
                </a>
                <p>Sun&rsquo;iy intellekt bilan taqdimot yarating, telefoningizdan boshqaring va auditoriyani o&lsquo;yinga jalb qiling.</p>
              </div>
              <div className="footer-links">
                <span>Xizmatlar</span>
                <a href="/taqdimot">Taqdimot qilish</a>
                <a href="/oyingoh">O&lsquo;yingoh</a>
                <a href="/tarif">Tariflar</a>
                <a href="/dokon">Do&lsquo;kon</a>
              </div>
              <div className="footer-links">
                <span>Ilova</span>
                <a href={STORE_IOS}>App Store</a>
                <a href={STORE_ANDROID}>Google Play</a>
              </div>
            </div>
            <div className="shell footer-base">
              <span>© {new Date().getFullYear()} Jaxongirman</span>
              <span>jaxongirman.app</span>
            </div>
          </footer>
        </BrandProvider>
      </body>
    </html>
  );
}
