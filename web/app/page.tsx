import Link from "next/link";

/**
 * The landing page.
 *
 * Two actions carry it, and they are deliberately oversized: the first thing
 * someone does on this site is open it on a lecture-hall projector and press
 * one of them from across the room. Everything else is below the fold.
 */
export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="hero-orb one" aria-hidden />
        <div className="hero-orb two" aria-hidden />
        <div className="shell">
          <p className="eyebrow animate-in delay-1">JAXONGIRMAN</p>
          <h1 className="animate-in delay-2">
            G&lsquo;oyangizni
            <br />
            taqdimotga aylantiring.
          </h1>
          <p className="lead animate-in delay-3">
            Sun&lsquo;iy intellekt bilan taqdimot yarating, telefoningizni pultga aylantiring va
            auditoriyadan ma&lsquo;lumot yig&lsquo;ing — barchasi bitta joyda.
          </p>

          <div className="hero-actions">
            <Link className="action primary animate-in delay-3" href="/taqdimot">
              TAQDIMOT QILISH
            </Link>
            <Link className="action secondary animate-in delay-4" href="/oyingoh">
              O&lsquo;YINGOHNI OCHISH
            </Link>
            <Link className="action secondary animate-in delay-4" href="/tarif">
              TARIF OLISH
            </Link>
          </div>
        </div>
      </section>

      <section className="section" id="imkoniyatlar">
        <div className="shell">
          <h2>Jaxongirman nima qiladi</h2>
          <p className="sub">
            Har bir bo&lsquo;lim mustaqil ishlaydi, lekin bitta hisob, bitta hamyon va bitta
            kutubxona bilan bog&lsquo;langan.
          </p>

          <div className="grid">
            <article className="card">
              <div className="glyph">✦</div>
              <h3>AI taqdimot</h3>
              <p>
                Mavzuni yozing — Jaxongir AI mazmun, vizual uslub va kompozitsiyani o&lsquo;zi
                tayyorlaydi. Tayyor slaydlarni muharrirda tahrirlaysiz.
              </p>
            </article>

            <article className="card">
              <div className="glyph">▤</div>
              <h3>Ma&lsquo;lumotlarni yig&lsquo;ish</h3>
              <p>
                So&lsquo;rovnoma tuzing, havolani ulashing va javoblarni jadval ko&lsquo;rinishida
                yuklab oling. Javoblar belgilangan muddatdan keyin avtomatik o&lsquo;chiriladi.
              </p>
            </article>

            <article className="card">
              <div className="glyph">▷</div>
              <h3>Taqdimot pulti</h3>
              <p>
                Ekranda QR chiqadi, telefoningiz bilan skaner qilasiz va slaydlarni masofadan
                boshqarasiz — surish, kattalashtirish, keyingisiga o&lsquo;tish.
              </p>
            </article>

            <article className="card">
              <div className="glyph">◈</div>
              <h3>Do&lsquo;kon</h3>
              <p>
                Tayyor taqdimot, mustaqil ish va referatlarni sotib oling yoki o&lsquo;zingiznikini
                soting. Do&lsquo;kon faqat ilovada ishlaydi.
              </p>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
