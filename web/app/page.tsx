import Link from "next/link";

import { HomeMotion } from "./_home/HomeMotion";
import { STORE_ANDROID, STORE_IOS } from "@/lib/stores";

import "./home.css";

/**
 * The landing page.
 *
 * It has two audiences at once. Someone at a lecture-hall projector came to
 * press "Taqdimot qilish" from across the room, so that action stays first and
 * large. Everyone else came to see what the product is, and for them the page
 * shows it working — slides being made, a phone driving a screen, a game in
 * progress — rather than describing it in paragraphs.
 *
 * Motion is CSS: scroll reveals use scroll-driven animations where the browser
 * has them and simply show the content where it does not, so nothing is ever
 * hidden behind a script. `HomeMotion` adds only what needs a pointer: the
 * stage's tilt, the cards' spotlight and the counters.
 */

const HEADLINE: { word: string; accent?: boolean }[] = [
  { word: "G‘oyangizni" },
  { word: "taqdimotga", accent: true },
  { word: "aylantiring." },
];

const MARQUEE = [
  "AI taqdimot", "Himoya matni", "Taqdimot pulti", "O‘yingoh", "Ilmiy ish",
  "So‘rovnoma", "Obyektivka", "PPTX import", "Do‘kon", "Portret",
];

function SlideGlass() {
  return (
    <div className="lp-slide lp-slide-glass">
      <span className="lp-orb a" />
      <span className="lp-orb b" />
      <div className="lp-glass-card">
        <i className="lp-chip">TA’LIM · 2026</i>
        <b>Sun’iy intellekt ta’limda</b>
        <em>Imkoniyatlar, xavflar va kelajak</em>
      </div>
      <div className="lp-glass-stats">
        <span><strong>86%</strong>talabalar</span>
        <span><strong>3×</strong>tezroq</span>
      </div>
    </div>
  );
}

function SlideEditorial() {
  return (
    <div className="lp-slide lp-slide-paper">
      <span className="lp-paper-block" />
      <i className="lp-paper-kicker">03 — TARIX</i>
      <b>Rivojlanish bosqichlari</b>
      <div className="lp-paper-rules"><span /><span /><span /></div>
    </div>
  );
}

function SlideSoft() {
  return (
    <div className="lp-slide lp-slide-soft">
      <div className="lp-soft-card">
        <b>Energiya samaradorligi</b>
        <span className="lp-soft-line" />
        <span className="lp-soft-line short" />
      </div>
      <span className="lp-soft-dial"><i /></span>
    </div>
  );
}

function SlideCorporate() {
  return (
    <div className="lp-slide lp-slide-corp">
      <span className="lp-corp-band" />
      <div className="lp-corp-card">
        <i />
        <b>Bozor <span>tahlili</span></b>
      </div>
      <span className="lp-corp-dots" />
    </div>
  );
}

const STYLES = [
  { name: "Liquid Glass", note: "Shaffof shisha, yumshoq yorug‘lik", slide: <SlideGlass /> },
  { name: "Jurnal uslubi", note: "Bosma nashr qat’iyligi, katta tipografika", slide: <SlideEditorial /> },
  { name: "Soft 3D", note: "Bir materialdan yasalgan futuristik qurilma", slide: <SlideSoft /> },
  { name: "Korporativ", note: "Brend shakllari va real soyalar", slide: <SlideCorporate /> },
];

export default function HomePage() {
  return (
    <main className="lp">
      <HomeMotion />

      {/* ---------------------------------------------------------------- hero */}
      <section className="lp-hero">
        <div className="lp-aurora" aria-hidden>
          <span className="one" />
          <span className="two" />
          <span className="three" />
        </div>
        <div className="lp-grid-lines" aria-hidden />

        <div className="lp-shell lp-hero-copy">
          <p className="lp-badge">
            <span className="lp-badge-dot" />
            Yangi: to‘rt xil premium dizayn uslubi
          </p>
          <h1 className="lp-title">
            {HEADLINE.map((part, index) => (
              <span key={part.word} className={`lp-word${part.accent ? " lp-accent" : ""}`} style={{ "--i": index } as React.CSSProperties}>
                {part.word}
              </span>
            ))}
          </h1>
          <p className="lp-lead">
            Mavzuni yozing — Jaxongir AI mazmunli, chiroyli taqdimotni o‘zi tayyorlaydi. Keyin uni
            telefoningizdan boshqarib, katta ekranda namoyish qilasiz.
          </p>

          <div className="lp-actions">
            <Link className="lp-btn lp-btn-primary" href="/taqdimot">
              <span>Taqdimot qilish</span>
              <span className="lp-btn-arrow" aria-hidden>→</span>
            </Link>
            <Link className="lp-btn lp-btn-glass" href="/oyingoh">O‘yingohni ochish</Link>
            <Link className="lp-btn lp-btn-glass" href="/tarif">Tarif olish</Link>
          </div>
          <p className="lp-gift">
            <span aria-hidden>✦</span> Yangi hisobga 10 slaydli <strong>3 ta taqdimot — bepul</strong>
          </p>
        </div>

        {/* The product, shown rather than described: a deck on a screen, the
            two styles beside it, and the phone that drives it. */}
        <div className="lp-stage-wrap" aria-hidden>
          <div className="lp-stage">
            <div className="lp-stage-side left"><SlideEditorial /></div>
            <div className="lp-stage-main"><SlideGlass /></div>
            <div className="lp-stage-side right"><SlideSoft /></div>
            <div className="lp-phone">
              <div className="lp-phone-screen">
                <span className="lp-phone-notch" />
                <div className="lp-phone-slide"><SlideGlass /></div>
                <span className="lp-phone-label">3 / 12 · Sun’iy intellekt ta’limda</span>
                <div className="lp-phone-keys"><i>‹</i><i className="on">Keyingi ›</i></div>
              </div>
            </div>
            <div className="lp-float-chip">
              <span className="lp-live-dot" /> Telefon ulandi
            </div>
          </div>
          <div className="lp-stage-glow" />
        </div>
      </section>

      {/* ------------------------------------------------------------- marquee */}
      <div className="lp-marquee" aria-hidden>
        <div className="lp-marquee-track">
          {[...MARQUEE, ...MARQUEE].map((item, index) => (
            <span key={`${item}-${index}`}>{item}<i>✦</i></span>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------- features */}
      <section className="lp-section" id="imkoniyatlar">
        <div className="lp-shell">
          <header className="lp-head" data-reveal>
            <p className="lp-kicker">Imkoniyatlar</p>
            <h2>Bitta ilova — <span className="lp-accent">butun taqdimot</span> jarayoni</h2>
            <p>Yaratishdan tortib himoyagacha: hammasi bitta hisob, bitta hamyon va bitta kutubxonada.</p>
          </header>

          <div className="lp-bento">
            <article className="lp-card span-4" data-reveal>
              <div className="lp-card-copy">
                <h3>AI taqdimot</h3>
                <p>Mavzuni yozing — mazmun, rasmlar, diagrammalar va dizaynni sun’iy intellekt o‘zi tayyorlaydi. Keyin muharrirda istalgan joyini o‘zgartirasiz.</p>
              </div>
              <div className="lp-vis-ai">
                <div className="lp-prompt">
                  <span className="lp-prompt-icon">✦</span>
                  <span className="lp-typing">Qayta tiklanuvchi energiya manbalari</span>
                  <span className="lp-prompt-go">Yaratish</span>
                </div>
                <div className="lp-thumbs">
                  <div className="lp-thumb t1"><SlideGlass /></div>
                  <div className="lp-thumb t2"><SlideCorporate /></div>
                  <div className="lp-thumb t3"><SlideEditorial /></div>
                </div>
              </div>
            </article>

            <article className="lp-card span-2" data-reveal>
              <div className="lp-vis-remote">
                <div className="lp-mini-phone"><span className="lp-qr" /><span className="lp-beam" /></div>
                <span className="lp-wave" />
              </div>
              <div className="lp-card-copy">
                <h3>Taqdimot pulti</h3>
                <p>Ekrandagi QR’ni skaner qiling — telefoningiz pultga aylanadi.</p>
              </div>
            </article>

            <article className="lp-card span-2" data-reveal>
              <div className="lp-vis-game">
                {[["A", 92], ["N", 74], ["S", 58], ["D", 41]].map(([who, score], index) => (
                  <div key={who} className="lp-bar" style={{ "--h": `${score}%`, "--i": index } as React.CSSProperties}>
                    <i>{who}</i>
                  </div>
                ))}
              </div>
              <div className="lp-card-copy">
                <h3>O‘yingoh</h3>
                <p>Auditoriya bilan jonli viktorina: savollar katta ekranda, javoblar telefonda.</p>
              </div>
            </article>

            <article className="lp-card span-2" data-reveal>
              <div className="lp-vis-paper">
                <div className="lp-sheet">
                  <div className="lp-sheet-head"><span /><i /></div>
                  <div className="lp-sheet-slide"><SlideCorporate /></div>
                  <span className="lp-sheet-line" /><span className="lp-sheet-line" /><span className="lp-sheet-line short" />
                </div>
              </div>
              <div className="lp-card-copy">
                <h3>Himoya matni</h3>
                <p>Har bir slayd uchun nima deyishni yozib beradi — premium PDF ko‘rinishida.</p>
              </div>
            </article>

            <article className="lp-card span-2" data-reveal>
              <div className="lp-vis-chart">
                {[38, 64, 52, 86, 70].map((height, index) => (
                  <span key={index} style={{ "--h": `${height}%`, "--i": index } as React.CSSProperties} />
                ))}
              </div>
              <div className="lp-card-copy">
                <h3>Ma’lumot yig‘ish</h3>
                <p>So‘rovnoma tuzing, havolani ulashing, natijani jadvalda oling.</p>
              </div>
            </article>

            <article className="lp-card span-3" data-reveal>
              <div className="lp-card-copy">
                <h3>Do‘kon</h3>
                <p>Tayyor taqdimot, mustaqil ish va referatlarni J tangaga sotib oling yoki o‘zingiznikini soting.</p>
              </div>
              <div className="lp-vis-store">
                <div className="lp-product p1"><span /><b>Biologiya · 14 slayd</b><i>45 J</i></div>
                <div className="lp-product p2"><span /><b>Iqtisodiyot · referat</b><i>30 J</i></div>
              </div>
            </article>

            <article className="lp-card span-3" data-reveal>
              <div className="lp-card-copy">
                <h3>Hujjatlar ham tayyor</h3>
                <p>Taqdimotdan tashqari — o‘qish va ish uchun kerakli hujjatlar.</p>
              </div>
              <div className="lp-tags">
                <span>Ilmiy ish</span><span>Obyektivka</span><span>Portret</span>
                <span>PPTX import</span><span>PDF eksport</span><span>PowerPoint</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- styles */}
      <section className="lp-section lp-section-tint" id="dizaynlar">
        <div className="lp-shell">
          <header className="lp-head" data-reveal>
            <p className="lp-kicker">Dizaynlar</p>
            <h2>To‘rt uslub. <span className="lp-accent">Cheksiz</span> ko‘rinish.</h2>
            <p>Har bir taqdimotning dizayni mavzusiga qarab yangidan yaratiladi — tayyor shablon yo‘q. Uslubni o‘zingiz tanlashingiz yoki AI’ga qo‘yib berishingiz mumkin.</p>
          </header>
          <div className="lp-styles">
            {STYLES.map((style) => (
              <article key={style.name} className="lp-style" data-reveal>
                <div className="lp-style-frame">{style.slide}</div>
                <h3>{style.name}</h3>
                <p>{style.note}</p>
              </article>
            ))}
          </div>
          <div className="lp-palette" data-reveal>
            <span>8 rang oilasi</span>
            {["#4F6BED", "#14B8A6", "#22A06B", "#D4A017", "#F08A24", "#E5484D", "#E2509C", "#8B5CF6"].map((color) => (
              <i key={color} style={{ background: color }} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- steps */}
      <section className="lp-section">
        <div className="lp-shell">
          <header className="lp-head" data-reveal>
            <p className="lp-kicker">Qanday ishlaydi</p>
            <h2>Uch qadamda <span className="lp-accent">sahnaga</span> tayyor</h2>
          </header>
          <ol className="lp-steps">
            <li data-reveal>
              <span className="lp-step-num">01</span>
              <h3>Mavzuni yozing</h3>
              <p>Sarlavha, slaydlar soni va xohlasangiz o‘qituvchi ismi — boshqa hech narsa kerak emas.</p>
            </li>
            <li data-reveal>
              <span className="lp-step-num">02</span>
              <h3>AI yaratadi</h3>
              <p>Manbalar izlanadi, mazmun yoziladi, rasmlar tanlanadi va dizayn noldan quriladi.</p>
            </li>
            <li data-reveal>
              <span className="lp-step-num">03</span>
              <h3>Ekranda namoyish qiling</h3>
              <p>Saytda “Taqdimot qilish”ni oching, QR’ni skaner qiling va slaydlarni telefondan boshqaring.</p>
            </li>
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- stats */}
      <section className="lp-stats-wrap">
        <div className="lp-shell lp-stats" data-reveal>
          <div><strong data-count="4">4</strong><span>dizayn uslubi</span></div>
          <div><strong data-count="8">8</strong><span>rang oilasi</span></div>
          <div><strong data-count="30">30</strong><span>slaydgacha</span></div>
          <div><strong data-count="3">3</strong><span>bepul taqdimot</span></div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ cta */}
      <section className="lp-section">
        <div className="lp-shell">
          <div className="lp-cta" data-reveal>
            <div className="lp-cta-aurora" aria-hidden><span /><span /></div>
            <p className="lp-kicker light">Boshlash</p>
            <h2>Keyingi taqdimotingiz — <span className="lp-accent light">eng yaxshisi</span> bo‘ladi.</h2>
            <p>Ilovani yuklab oling, hisob oching va birinchi uchta taqdimotni bepul yarating.</p>
            <div className="lp-cta-actions">
              <a className="lp-store" href={STORE_IOS}>
                <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.29-.88-2.3-3.5zM14.2 6.12c.6-.74 1.01-1.75.9-2.77-.87.04-1.93.58-2.55 1.31-.56.65-1.05 1.69-.92 2.69.97.07 1.96-.49 2.57-1.23z"/></svg>
                <span><small>Yuklab oling</small>App Store</span>
              </a>
              <a className="lp-store" href={STORE_ANDROID}>
                <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M3.6 2.2c-.23.25-.36.63-.36 1.12v17.36c0 .49.13.87.37 1.12l.06.05 9.73-9.73v-.23L3.66 2.15l-.06.05zm12.98 13.17-3.24-3.25v-.23l3.24-3.25.07.04 3.84 2.18c1.1.62 1.1 1.64 0 2.27l-3.84 2.18-.07.06zm.07-.05L13.34 12 3.6 21.8c.36.38.95.43 1.62.05l11.43-6.53zm0-6.64L5.22 2.17c-.67-.38-1.26-.33-1.62.05L13.34 12l3.31-3.32z"/></svg>
                <span><small>Yuklab oling</small>Google Play</span>
              </a>
              <Link className="lp-btn lp-btn-light" href="/taqdimot">
                <span>Taqdimot qilish</span>
                <span className="lp-btn-arrow" aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
