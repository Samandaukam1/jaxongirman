/**
 * The four slide styles, drawn small.
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
