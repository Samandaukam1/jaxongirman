import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "O'yingoh — Jaxongirman",
  description: "Jaxongirman o'yingohi tayyorlanmoqda.",
};

/**
 * The games surface.
 *
 * Nothing in the database describes a game yet, so this route exists and says
 * what it is for rather than showing a quiz that does not run. When the module
 * lands, the host flow replaces this card and the URL stays the same.
 */
export default function ArenaPage() {
  return (
    <main className="notice-page">
      <div className="shell">
        <div className="notice-card">
          <div className="glyph" style={{ margin: "0 auto" }}>◎</div>
          <h1>O&lsquo;yingoh tayyorlanmoqda</h1>
          <p>
            Bilim musobaqalari — savollar, ball va natijalar jadvali — ustida ish ketmoqda.
            Ishga tushganda shu sahifadan o&lsquo;yin boshlash va qatnashchilarni QR orqali
            taklif qilish mumkin bo&lsquo;ladi.
          </p>
          <div className="store-row">
            <a className="store-button ghost" href="/">Bosh sahifaga qaytish</a>
          </div>
        </div>
      </div>
    </main>
  );
}
