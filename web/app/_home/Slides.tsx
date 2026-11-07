import { Globe } from "lucide-react";

/**
 * The slide styles, drawn small.
 *
 * They live apart from the page because two things show them: the landing page
 * itself, and the download prompt that opens over it (`AppPromo`). Their styles
 * are the `lp-slide` block in home.css.
 */

export function SlideGlass() {
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

export function SlideEditorial() {
  return (
    <div className="lp-slide lp-slide-paper">
      <span className="lp-paper-block" />
      <i className="lp-paper-kicker">03 — TARIX</i>
      <b>Rivojlanish bosqichlari</b>
      <div className="lp-paper-rules"><span /><span /><span /></div>
    </div>
  );
}

export function SlideSoft() {
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

export function SlideCorporate() {
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

export function SlideNaqsh() {
  return (
    <div className="lp-slide lp-slide-naqsh">
      <span className="lp-naqsh-band" />
      <span className="lp-naqsh-star"><i /><i /></span>
      <b>Buyuk ipak yo‘li</b>
      <span className="lp-naqsh-line" />
      <span className="lp-naqsh-line short" />
    </div>
  );
}

export function SlideSpektr() {
  return (
    <div className="lp-slide lp-slide-spektr">
      <Globe className="lp-spektr-icon" strokeWidth={0.6} aria-hidden />
      <i className="lp-spektr-chip">INFOGRAFIKA</i>
      <b>Raqamli iqtisodiyot</b>
      <em>2026 yil natijalari</em>
      <span className="lp-spektr-bar" />
    </div>
  );
}

export function SlideMozaika() {
  return (
    <div className="lp-slide lp-slide-mozaika">
      <div className="lp-moz-words"><b>Shakl va rang</b><em>Ijodiy loyiha</em></div>
      <div className="lp-moz-grid">
        <i className="a" />
        <i className="b"><span /></i>
        <i className="c" />
        <i className="d" />
        <i className="e" />
        <i className="f" />
      </div>
    </div>
  );
}

/** Not a look of its own: the choice that leaves the look to the generator, so it shows the others. */
export function SlideAuto() {
  return (
    <div className="lp-slide lp-slide-auto">
      <span className="lp-auto-card one" />
      <span className="lp-auto-card two" />
      <span className="lp-auto-card three" />
      <span className="lp-auto-card four" />
      <b className="lp-auto-pill"><i>✦</i> Jaxongir AI tanlaydi</b>
    </div>
  );
}
