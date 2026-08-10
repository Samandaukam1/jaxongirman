import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Do'kon — Jaxongirman ilovasida",
  description: "Jaxongirman Do'koni faqat mobil ilovada ishlaydi. Ilovani yuklab oling.",
};

/**
 * The marketplace is an in-app service.
 *
 * There is no catalogue here on purpose — the database refuses to show a
 * product to a signed-out reader at all, and rendering a shop the browser
 * cannot complete a purchase in would be worse than saying so plainly.
 */
export default function MarketplaceNoticePage() {
  return (
    <main className="notice-page">
      <div className="shell">
        <div className="notice-card">
          <div className="glyph" style={{ margin: "0 auto" }}>◈</div>
          <h1>Do&lsquo;kon faqat ilovada</h1>
          <p>
            Tayyor taqdimotlar, mustaqil ishlar va referatlarni sotib olish hamda sotish
            Jaxongirman mobil ilovasi orqali amalga oshiriladi. Bu xizmat saytda ishlamaydi.
          </p>
          <div className="store-row">
            <a className="store-button" href="https://apps.apple.com/app/id0000000000">App Store</a>
            <a className="store-button ghost" href="https://play.google.com/store/apps/details?id=uz.jaxongirman.app">
              Google Play
            </a>
          </div>
          <p className="store-note">
            Ilovada: xarid tarixi, yuklab olish, sotuvchi paneli va daromadlar hisoboti.
          </p>
        </div>
      </div>
    </main>
  );
}
