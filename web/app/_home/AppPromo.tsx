"use client";

import {
  ArrowRight, BatteryFull, Bell, Check, ClipboardList, Gamepad2, House, Layers, LifeBuoy, MonitorPlay, Plus, QrCode,
  Search, Share2, Signal, Smartphone, Sparkles, Store, User, Wifi, X, type LucideIcon,
} from "lucide-react";
import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { useBrand } from "@/app/_brand/BrandContext";
import { AppleLogo, GooglePlayLogo } from "@/app/_brand/StoreLogos";
import { APP_LINK, STORE_ANDROID, STORE_IOS } from "@/lib/stores";
import { SlideCorporate, SlideEditorial, SlideGlass, SlideSoft } from "./Slides";

import "./app-promo.css";

/**
 * "Ilovani yuklab oling", opened over the landing page once per visit.
 *
 * Only the home page mounts this. `/taqdimot`, `/oyingoh` and the pages a QR
 * lands on are reached by someone in the middle of something, often in front of
 * a room, and an advert there would stand between them and the projector.
 *
 * A phone sees it too, in the narrow layout, and installs straight from the store
 * buttons. A computer cannot install the app, which is what "Ulashish" is for: it
 * hands over `/ilova`, the link that sends each phone to its own store.
 *
 * A visit is a tab's session: the mark lives in sessionStorage, so moving around
 * the site does not bring the prompt back, and closing the browser does.
 *
 * It lasts one pass through the four screens, fifteen seconds, and then closes
 * itself; the ring on the close button is that clock. The clock holds while the
 * pointer or the keyboard is on the store buttons or the close button, so nobody
 * loses the prompt on the way to pressing it. With reduced motion nothing moves
 * and nothing closes on its own.
 *
 * The screens inside the laptop and the phone are drawn here from the app's own
 * strings, colours and tool art, at the app's real sizes, then scaled down. What
 * they do not show is Do‘kon: an iPhone with payments turned off has no shop, and
 * this advert promises that phone the same things it promises every other.
 */

const SEEN_KEY = "jaxongirman.appPromo.seen.v1";
/** Lets the page paint first, so the prompt opens over a site and not a blank. */
const OPEN_DELAY = 350;
const CLOSE_MS = 260;
/** Past this the devices stop growing; a 4K window should not get a 4K phone. */
const MAX_SCALE = 1.45;

const PHONE_HEIGHT = 856;
const NAV_WIDTH = 358;
const NAV_INSET = 6;

function alreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    window.sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage blocked: the prompt simply opens again on the next load.
  }
}

export function AppPromo() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (alreadySeen()) return;
    // Marked when it opens, not before the timer: in development an effect runs
    // twice, and a mark set here would cancel the second run's prompt.
    const timer = setTimeout(() => { markSeen(); setOpen(true); }, OPEN_DELAY);
    return () => clearTimeout(timer);
  }, []);

  return open ? createPortal(<Prompt onClosed={() => setOpen(false)} />, document.body) : null;
}

type Place = "home" | "games" | "projects" | "pult";
type Point = { x: number; y: number };

const STEPS: { place: Place; ms: number; nav: number }[] = [
  { place: "home", ms: 3600, nav: 0 },
  { place: "games", ms: 3200, nav: 3 },
  { place: "projects", ms: 3200, nav: 1 },
  { place: "pult", ms: 5000, nav: 1 },
];

/** When the remote's "Keyingi" is pressed, counted from the start of its step. */
const PRESSES = [1200, 2400, 3600];

const DECK = [
  { slide: <SlideGlass />, title: "Sun’iy intellekt ta’limda", page: "3 / 12" },
  { slide: <SlideEditorial />, title: "Rivojlanish bosqichlari", page: "4 / 12" },
  { slide: <SlideSoft />, title: "Energiya samaradorligi", page: "5 / 12" },
  { slide: <SlideCorporate />, title: "Bozor tahlili", page: "6 / 12" },
];

const NAV: { icon: LucideIcon; label: string }[] = [
  { icon: House, label: "Bosh sahifa" },
  { icon: Layers, label: "Loyihalar" },
  { icon: Store, label: "Do‘kon" },
  { icon: Gamepad2, label: "O‘yinlar" },
  { icon: User, label: "Profil" },
];

const art = (name: string) => `/brand/promo/${name}.png`;

function navPoint(index: number): Point {
  const item = (NAV_WIDTH - NAV_INSET * 2) / NAV.length;
  return { x: 16 + NAV_INSET + item * index + item / 2, y: PHONE_HEIGHT - 20 - 36 };
}

/** Where an element sits on the phone's unscaled screen. */
function pointOn(element: HTMLElement | null, screen: HTMLElement | null): Point | null {
  if (!element || !screen) return null;
  let x = element.offsetWidth / 2;
  let y = element.offsetHeight / 2;
  for (let node: HTMLElement | null = element; node && node !== screen; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}

function Prompt({ onClosed }: { onClosed: () => void }) {
  const brand = useBrand();
  const [calm] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [closing, setClosing] = useState(false);
  const [step, setStep] = useState(0);
  const [slide, setSlide] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [tap, setTap] = useState<(Point & { id: number }) | null>(null);
  const [shared, setShared] = useState<"no" | "copied" | "shown">("no");

  const stage = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const presentTile = useRef<HTMLDivElement>(null);
  const nextKey = useRef<HTMLElement>(null);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(onClosed, CLOSE_MS);
  }, [onClosed]);

  // The page behind stays still, and focus comes back to where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      root.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  // The devices keep their proportions at any window size.
  useEffect(() => {
    const root = dialog.current;
    const box = scene.current;
    const target = tilt.current;
    if (!root || !box || !target) return;
    const fit = () => {
      const css = getComputedStyle(root);
      const width = parseFloat(css.getPropertyValue("--rig-w")) || 880;
      const height = parseFloat(css.getPropertyValue("--rig-h")) || 790;
      const scale = Math.min(box.clientWidth / width, box.clientHeight / height, MAX_SCALE);
      target.style.setProperty("--k", scale.toFixed(3));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // The devices lean toward the pointer, as the hero stage does.
  useEffect(() => {
    const root = stage.current;
    const target = tilt.current;
    if (calm || !root || !target || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    const lean = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        target.style.setProperty("--py", `${(x * 12).toFixed(2)}deg`);
        target.style.setProperty("--px", `${(-y * 8).toFixed(2)}deg`);
      });
    };
    root.addEventListener("pointermove", lean, { passive: true });
    return () => {
      root.removeEventListener("pointermove", lean);
      cancelAnimationFrame(frame);
    };
  }, [calm]);

  // One step of the tour: a tap on whatever opens the next screen, then that screen.
  useEffect(() => {
    if (calm) return;
    const { place, ms } = STEPS[step]!;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (delay: number, run: () => void) => { timers.push(setTimeout(run, delay)); };
    const touch = (point: Point | null) => {
      if (point) setTap((last) => ({ ...point, id: (last?.id ?? 0) + 1 }));
    };

    if (place === "pult") {
      PRESSES.forEach((moment, index) => {
        at(moment - 260, () => { touch(pointOn(nextKey.current, screen.current)); setPressed(true); });
        at(moment, () => { setSlide(index + 1); setPressed(false); });
      });
    } else {
      const target = place === "home" ? navPoint(3) : place === "games" ? navPoint(1) : null;
      at(ms - 520, () => touch(target ?? pointOn(presentTile.current, screen.current)));
    }

    at(ms, () => {
      const next = (step + 1) % STEPS.length;
      if (STEPS[next]!.place === "pult") setSlide(0);
      setStep(next);
    });
    return () => timers.forEach(clearTimeout);
  }, [calm, step]);

  // A touch screen has a share sheet worth opening. On a computer that sheet is a
  // detour on the way to pasting the link somewhere, so it is copied at once.
  async function share() {
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: "Jaxongirman", text: "Jaxongirman ilovasini yuklab oling", url: APP_LINK }).catch(() => {});
      return;
    }
    // A refused clipboard still shows the link, to be copied by hand, without the
    // tick that would claim it was.
    const copied = await navigator.clipboard?.writeText(APP_LINK).then(() => true, () => false);
    setShared(copied ? "copied" : "shown");
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const stops = Array.from(dialog.current.querySelectorAll<HTMLElement>("a[href], button"));
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog.current)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  const { place, nav } = STEPS[step]!;
  const deck = DECK[slide]!;
  const layer = (name: Place, kind: string) => `ap-layer ${kind}${place === name ? " on" : ""}`;

  return (
    <div ref={stage} className={`ap-stage${closing ? " is-closing" : ""}`}>
      <section
        ref={dialog}
        className="ap"
        role="dialog"
        aria-modal="true"
        aria-label="Jaxongirman ilovasini yuklab oling"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="ap-bg" aria-hidden>
          <i className="ap-glow one" />
          <i className="ap-glow two" />
          <i className="ap-glow three" />
          <i className="ap-grid" />
        </div>

        <button type="button" className="ap-close" aria-label="Yopish" onClick={close}>
          <svg className="ap-ring" viewBox="0 0 48 48" aria-hidden>
            <circle cx="24" cy="24" r="22.5" onAnimationEnd={close} />
          </svg>
          <X size={20} aria-hidden />
        </button>

        <div className="ap-body">
          <div className="ap-copy">
            <div className="ap-brand" style={{ "--i": 0 } as CSSProperties}>
              <img src={brand.logo} alt="" width={56} height={56} />
              <span><b>Jaxongirman</b><small>Rasmiy mobil ilova</small></span>
            </div>
            <p className="ap-badge" style={{ "--i": 1 } as CSSProperties}><span className="ap-dot" />Bepul · iOS va Android</p>
            <h2 className="ap-title" style={{ "--i": 2 } as CSSProperties}>
              <span>Jaxongirman</span> <span>ilovasini</span> <em>yuklab oling</em>
            </h2>
            <p className="ap-lead" style={{ "--i": 3 } as CSSProperties}>
              AI taqdimot, O‘yingoh, himoya matni va hujjatlar — barchasi bitta ilovada. Telefoningizda yarating,
              katta ekranda boshqaring.
            </p>
            <ul className="ap-chips" style={{ "--i": 4 } as CSSProperties}>
              <li><Sparkles aria-hidden />AI taqdimot</li>
              <li><Gamepad2 aria-hidden />O‘yingoh</li>
              <li><Smartphone aria-hidden />Taqdimot pulti</li>
            </ul>
            <div className="ap-stores" style={{ "--i": 5 } as CSSProperties}>
              <a className="ap-store" href={STORE_IOS} target="_blank" rel="noopener noreferrer">
                <AppleLogo />
                <span><small>Yuklab oling</small>App Store</span>
              </a>
              <a className="ap-store" href={STORE_ANDROID} target="_blank" rel="noopener noreferrer">
                <GooglePlayLogo />
                <span><small>Yuklab oling</small>Google Play</span>
              </a>
            </div>
            <div className="ap-actions" style={{ "--i": 6 } as CSSProperties}>
              <button type="button" className="ap-share" onClick={() => void share()}>
                {shared === "copied" ? <Check size={16} aria-hidden /> : <Share2 size={16} aria-hidden />}
                <span aria-live="polite">{shared === "no" ? "Ulashish" : APP_LINK.replace("https://", "")}</span>
              </button>
              <button type="button" className="ap-skip" onClick={close}>
                Saytda davom etish <ArrowRight size={16} aria-hidden />
              </button>
            </div>
          </div>

          <div ref={scene} className="ap-scene" aria-hidden>
            <div ref={tilt} className="ap-tilt">
              <div className="ap-rig">
                <div className="ap-lap">
                  <div className="ap-lid">
                    <div className="ap-lid-front">
                      <div className="ap-lscreen">
                        <div className="ap-lui">
                          <div className="ap-lchrome"><i /><i /><i /><span>jaxongirman.app/app</span></div>
                          <LaptopMenu logo={brand.logo} place={place} />
                          <div className={layer("home", "ap-ll")}><Greeting /><Voucher /><Feature /></div>
                          <div className={layer("games", "ap-ll")}><Games shelf={3} /></div>
                          <div className={layer("projects", "ap-ll")}><Projects /></div>
                          <div className={layer("pult", "ap-lfull")}>
                            <Deck slide={slide} />
                            <div className="ap-lcount"><span className="ap-live" /><span>{deck.page}</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="ap-lid-back"><img src={brand.logo} alt="" /></div>
                  </div>
                  <div className="ap-deck"><div className="ap-deck-front" /></div>
                </div>

                <div className="ap-phone">
                  <div className="ap-pscreen">
                    <div ref={screen} className="ap-pui">
                      <div className={`ap-sb${place === "pult" ? " clear" : ""}`}>
                        9:41<span><Signal /><Wifi /><BatteryFull /></span>
                      </div>
                      <div className={layer("home", "ap-pl")}>
                        <div className="ap-scroll moves">
                          <Greeting />
                          <Voucher />
                          <Feature />
                          <div className="ap-sec">Jaxongirman tavsiya qiladi</div>
                          <div className="ap-row">
                            <span className="ap-row-th"><SlideEditorial /></span>
                            <span className="ap-row-t"><b>Himoya matni</b><small>Har bir slayd uchun tayyor matn</small></span>
                          </div>
                          <div className="ap-row">
                            <span className="ap-row-th"><SlideSoft /></span>
                            <span className="ap-row-t"><b>Taqdimot pulti</b><small>Slaydlarni telefondan boshqaring</small></span>
                          </div>
                        </div>
                      </div>
                      <div className={layer("games", "ap-pl")}><div className="ap-scroll"><Games shelf={2} /></div></div>
                      <div className={layer("projects", "ap-pl")}><div className="ap-scroll"><Projects present={presentTile} /></div></div>
                      <div className={layer("pult", "ap-rm")}>
                        <div className="ap-rm-h"><b>Taqdimot pulti</b><span><span className="ap-live" />Ulandi</span></div>
                        <Deck slide={slide} className="ap-rm-slide" />
                        <div className="ap-rm-l"><b>{deck.page}</b><span>{deck.title}</span></div>
                        <div className="ap-rm-note">
                          <b>HIMOYA MATNI</b>
                          Bugun sizga sun’iy intellekt ta’limni qanday o‘zgartirayotganini ko‘rsataman.
                        </div>
                        <div className="ap-rm-keys">
                          <i>‹</i>
                          <i ref={nextKey} className={`next${pressed ? " hit" : ""}`}>Keyingi ›</i>
                        </div>
                      </div>
                      <div className={`ap-bnav${place === "pult" ? " away" : ""}`} style={{ "--n": nav } as CSSProperties}>
                        <i className="ap-bnav-pill" />
                        {NAV.map(({ icon: Icon, label }, index) => (
                          <span key={label} className={index === nav ? "on" : undefined}><Icon /><em>{label}</em></span>
                        ))}
                      </div>
                      {tap ? <i key={tap.id} className="ap-tap" style={{ left: tap.x, top: tap.y }} /> : null}
                    </div>
                  </div>
                </div>

                <div className="ap-fc">
                  <Caption on={place === "home"} art={<img src={art("coin")} alt="" />} title="3 ta taqdimot bepul" note="Yangi hisobga sovg‘a" />
                  <Caption on={place === "games"} art={<span className="ap-fc-tile"><Gamepad2 /></span>} title="O‘yingoh" note="Auditoriya bilan jonli viktorina" />
                  <Caption on={place === "projects"} art={<img src={art("slide-create")} alt="" />} title="Jaxongir AI" note="Mavzuni yozing, taqdimot tayyor" />
                  <Caption on={place === "pult"} art={<img src={art("present")} alt="" />} title="Taqdimot pulti" note="Telefoningiz pultga aylanadi" />
                </div>
                <div className="ap-chip">
                  <span className="ap-live" />
                  <span>{place === "pult" ? "Telefon ulandi" : "Bitta hisob, ikki qurilma"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Caption({ on, art: picture, title, note }: { on: boolean; art: ReactNode; title: string; note: string }) {
  return <div className={`ap-fc-i${on ? " on" : ""}`}>{picture}<span><b>{title}</b><small>{note}</small></span></div>;
}

function Deck({ slide, className = "" }: { slide: number; className?: string }) {
  return (
    <div className={`ap-deckbox ${className}`}>
      {DECK.map((item, index) => (
        <div key={item.title} className={`ap-sl${index === slide ? " on" : ""}`}>{item.slide}</div>
      ))}
    </div>
  );
}

/** A made-up account: this is what a new one opens to, not anybody's data. */
function Greeting() {
  return (
    <div className="ap-hd">
      <span className="ap-av">AS</span>
      <span className="ap-hd-t"><b>Salom, Aziz 👋</b><small>7-noyabr, shanba · 09:41</small></span>
      <span className="ap-round"><Bell /><i>2</i></span>
    </div>
  );
}

/** `WelcomeHero`, the card a new account lands on, full: three untouched decks. */
function Voucher() {
  return (
    <div className="ap-vch">
      <div className="ap-vch-top"><span>Xush kelibsiz sovg‘asi</span><i>30 / 30 sahifa</i></div>
      <div className="ap-vch-hero">
        <b>3</b>
        <span><strong>bepul<br />taqdimot</strong><small>har biri 10 sahifagacha</small></span>
      </div>
      <p>JAXONGIRMAN bilan ilk taqdimotlaringiz bizdan.</p>
      <div className="ap-vch-perf" />
      <div className="ap-vch-slots">
        {[1, 2, 3].map((number, index) => (
          <div key={number}>
            <span className="ap-vch-track"><i style={{ "--d": index } as CSSProperties} /></span>
            <small>{number} · 10 sahifa</small>
          </div>
        ))}
      </div>
      <div className="ap-vch-cta">Bepul taqdimot yaratish <ArrowRight size={18} /></div>
      <div className="ap-vch-foot"><span>J Tanga balansi</span><b>0 J</b></div>
    </div>
  );
}

function Feature() {
  return (
    <div className="ap-feat">
      <span className="ap-feat-ic"><ClipboardList /></span>
      <span className="ap-feat-t">
        <b>Ma’lumotlarni yig‘ish</b>
        <small>So‘rovnoma yarating, yuboring va natijalarni jadval ko‘rinishida oling.</small>
      </span>
      <span className="ap-feat-go">Ochish <ArrowRight size={16} /></span>
    </div>
  );
}

function Balance() {
  return <span className="ap-bal"><img src={art("coin")} alt="" />0</span>;
}

const FREE_GAMES = [
  { title: "Tarix viktorinasi", questions: 20, cover: "linear-gradient(135deg, #F97316, #BE123C)" },
  { title: "Mantiq bellashuvi", questions: 15, cover: "linear-gradient(135deg, #11A2B8, #3B2C9E)" },
  { title: "Biologiya sinovi", questions: 18, cover: "linear-gradient(135deg, #16A77B, #0A6E86)" },
];

function Games({ shelf }: { shelf: number }) {
  return (
    <>
      <div className="ap-ttl"><h3>O‘yingoh</h3><Balance /></div>
      <div className="ap-g-create">
        <span className="ap-g-ic"><Sparkles /></span>
        <span className="ap-g-t"><b>Yangi o‘yin yaratish</b><small>AI bilan, matndan yoki qo‘lda</small></span>
        <ArrowRight size={18} />
      </div>
      <div className="ap-g-row">
        <div className="ap-g-half join"><QrCode /><b>O‘yinga qo‘shilish</b><small>QR yoki kod</small></div>
        <div className="ap-g-half host"><MonitorPlay /><b>Mezbon bo‘lish</b><small>Katta ekranni ulash</small></div>
      </div>
      <div className="ap-g-stats">
        <span><b>12</b><small>O‘yinlar</small></span>
        <span><b>5</b><small>G‘alabalar</small></span>
        <span><b>8</b><small>Top 3</small></span>
        <span><b>340</b><small>J mukofot</small></span>
      </div>
      <div className="ap-sec">Bepul o‘yinlar <small>Barchasi</small></div>
      <div className="ap-g-shelf">
        {FREE_GAMES.slice(0, shelf).map((game) => (
          <div key={game.title} className="ap-g-card">
            <div className="ap-g-cover" style={{ background: game.cover }}><i>Bepul</i></div>
            <b>{game.title}</b>
            <small>{game.questions} ta savol</small>
          </div>
        ))}
      </div>
    </>
  );
}

type ToolProps = { picture: string; label: string; detail: string; tint: string; kind?: "hero" | "wide"; tile?: RefObject<HTMLDivElement | null> };

function Tool({ picture, label, detail, tint, kind, tile }: ToolProps) {
  return (
    <div ref={tile} className={`ap-tool${kind ? ` ${kind}` : ""}`} style={{ "--t": tint } as CSSProperties}>
      <img src={art(picture)} alt="" />
      <span><b>{label}</b><small>{detail}</small></span>
      {kind === "hero" ? <ArrowRight /> : null}
    </div>
  );
}

/** Loyihalar. `present` hands back the tile the tour taps to reach the remote. */
function Projects({ present }: { present?: RefObject<HTMLDivElement | null> }) {
  return (
    <>
      <div className="ap-ttl"><h3>Loyihalar</h3><span className="ap-round"><Search /></span><Balance /></div>
      <div className="ap-tools">
        <Tool picture="slide-create" label="Taqdimot yaratish" detail="Jaxongir AI bilan yangi slayd" tint="#856BFA" kind="hero" />
        <Tool picture="portrait" label="3×4 rasm" detail="Hujjatga" tint="#506FFB" />
        <Tool picture="objective" label="Obyektivka" detail="DOCX / PDF" tint="#608EFB" />
        <Tool picture="academic" label="Ilmiy ish" detail="Maqola, referat" tint="#23C9C2" />
        <Tool picture="powerpoint" label="PowerPoint" detail="Yuklab tahrirlash" tint="#FD6743" kind="wide" />
        <Tool picture="present" label="Taqdimot qilish" detail="Katta ekranga" tint="#666AFB" kind="wide" tile={present} />
      </div>
      <div className="ap-sec">Oxirgi ishlaringiz</div>
      <div className="ap-row">
        <span className="ap-row-th"><SlideGlass /></span>
        <span className="ap-row-t"><b>Sun’iy intellekt ta’limda</b><small>Taqdimot · 12 slayd</small></span>
        <i>Tayyor</i>
      </div>
    </>
  );
}

const MENU: { key: Place | "store" | "profile"; icon: LucideIcon | null; label: string }[] = [
  { key: "home", icon: House, label: "Bosh sahifa" },
  { key: "projects", icon: Layers, label: "Loyihalar" },
  { key: "store", icon: Store, label: "Do‘kon" },
  { key: "games", icon: Gamepad2, label: "O‘yinlar" },
  { key: "profile", icon: null, label: "Profil" },
];

const MORE: { icon: LucideIcon; label: string }[] = [
  { icon: Bell, label: "Bildirishnomalar" },
  { icon: ClipboardList, label: "So‘rovnomalar" },
  { icon: Sparkles, label: "Tariflar" },
  { icon: LifeBuoy, label: "Yordam markazi" },
];

/** `DesktopShell`'s sidebar, in the width the app gives it at this scale. */
function LaptopMenu({ logo, place }: { logo: string; place: Place }) {
  return (
    <div className="ap-lside">
      <div className="ap-lbrand"><img src={logo} alt="" /><b>JAXONGIRMAN</b></div>
      <div className="ap-lnew"><Plus size={16} />Taqdimot yaratish</div>
      <div className="ap-lgrp">
        {MENU.map(({ key, icon: Icon, label }) => (
          <div key={key} className={`ap-lit${key === place ? " on" : ""}`}>
            {Icon ? <Icon /> : <span className="ap-mini">AS</span>}{label}
          </div>
        ))}
      </div>
      <div className="ap-llabel">BOSHQA</div>
      <div className="ap-lgrp">
        {MORE.map(({ icon: Icon, label }) => <div key={label} className="ap-lit"><Icon />{label}</div>)}
      </div>
      <div className="ap-lwallet">
        <img src={art("coin")} alt="" />
        <span>J Tanga balansi<b>0</b></span>
        <em>To‘ldirish</em>
      </div>
    </div>
  );
}
