import { parseInline, PROMO_BANNER_RATIO, type PromoBlock, type PromoButton, type PromoFont } from "@jaxongirman/types";
import { ArrowUpRight, ChevronLeft, ChevronRight, Megaphone, Play } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { FONT_FACES, type PromoDraft } from "@/lib/promos";

/**
 * The phone, as the app will draw it: the banner on Bosh sahifa, then the
 * article it opens. Same parser, same proportions, same type — so what the
 * editor sees is what a person sees, short of the phone's own fonts and
 * scrolling.
 */


export function RichInline({ source, accent }: { source: string; accent: string }) {
  return (
    <>
      {parseInline(source).map((span, index) => {
        const style: CSSProperties = {
          fontWeight: span.bold ? 700 : undefined,
          fontStyle: span.italic ? "italic" : undefined,
          textDecoration: [span.underline || span.href ? "underline" : "", span.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
          color: span.color ?? (span.href ? accent : undefined),
          background: span.highlight ? `${span.highlight}8C` : undefined,
          borderRadius: span.highlight ? 3 : undefined,
        };
        return span.href
          ? <a key={index} href={span.href.startsWith("/") ? undefined : span.href} target="_blank" rel="noreferrer" style={style} title={span.href}>{span.text}</a>
          : <span key={index} style={style}>{span.text}</span>;
      })}
    </>
  );
}

export function PreviewButton({ button }: { button: PromoButton }) {
  const [from, to] = button.colors;
  const style: CSSProperties = button.fill === "gradient"
    ? { background: `linear-gradient(135deg, ${from}, ${to})`, color: inkFor(from) }
    : button.fill === "solid"
      ? { background: from, color: inkFor(from) }
      : { background: "transparent", color: from, boxShadow: `inset 0 0 0 2px ${from}` };
  return (
    <div className={`pp-button-wrap${button.glow ? " glow" : ""}`} style={{ "--glow": from } as CSSProperties}>
      <span className={`pp-button${button.glow && button.fill !== "outline" ? " sheen" : ""}`} style={style}>
        {button.label || "Tugma"}
        {/^https?:\/\//i.test(button.url) ? <ArrowUpRight size={15} /> : null}
      </span>
    </div>
  );
}

function inkFor(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0) > 0.55 ? "#150E24" : "#FFFFFF";
}

function Media({ url, kind, className }: { url: string | null; kind: "image" | "video"; className: string }) {
  if (!url) return <div className={`${className} pp-media-empty`}><span>Rasm yo‘q</span></div>;
  return kind === "video"
    ? <video className={className} src={url} autoPlay muted loop playsInline />
    : <img className={className} src={url} alt="" />;
}

const CALLOUT: Record<string, string> = { brand: "#6C34C9", gold: "#E3A41C", success: "#10B981", danger: "#F43F5E" };

function Block({ block, accent, faces }: { block: PromoBlock; accent: string; faces: (typeof FONT_FACES)[PromoFont] }): ReactNode {
  switch (block.type) {
    case "heading":
      return block.text.trim() ? <h3 className={`pp-h${block.level}`} style={{ fontFamily: faces.display }}>{block.text}</h3> : null;
    case "text":
      return block.text.trim()
        ? <p className={`pp-text${block.size === "large" ? " large" : ""}`} style={{ textAlign: block.align }}><RichInline source={block.text} accent={accent} /></p>
        : null;
    case "quote":
      return block.text.trim() ? (
        <blockquote className="pp-quote" style={{ borderColor: accent }}>
          <span className="pp-quote-mark" style={{ color: accent, fontFamily: faces.display }}>“</span>
          <p style={{ fontFamily: faces.quote }}><RichInline source={block.text} accent={accent} /></p>
          {block.cite ? <cite>— {block.cite}</cite> : null}
        </blockquote>
      ) : null;
    case "callout":
      return block.text.trim() ? (
        <div className="pp-callout" style={{ "--tone": CALLOUT[block.tone] } as CSSProperties}>
          <p><RichInline source={block.text} accent={accent} /></p>
        </div>
      ) : null;
    case "image":
      return block.url ? <figure className="pp-figure"><img src={block.url} alt="" />{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure> : null;
    case "video":
      return block.url ? <figure className="pp-figure"><video src={block.url} controls playsInline />{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure> : null;
    case "audio":
      return block.url ? (
        <figure className="pp-figure">
          <div className="pp-audio">
            <span className="pp-audio-play" style={{ background: `linear-gradient(135deg, ${accent}, #1E0B4A)` }}><Play size={16} fill="#fff" /></span>
            <div><strong>{block.title || "Audio"}</strong><audio src={block.url} controls /></div>
          </div>
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      ) : null;
    case "list": {
      const items = block.items.filter((item) => item.trim());
      if (items.length === 0) return null;
      const Tag = block.ordered ? "ol" : "ul";
      return <Tag className="pp-list" style={{ "--accent": accent } as CSSProperties}>{items.map((item, index) => <li key={index}><RichInline source={item} accent={accent} /></li>)}</Tag>;
    }
    case "divider":
      return <div className="pp-divider"><span /><i style={{ background: accent }} /><span /></div>;
    case "button":
      return block.button.pinned ? null : <PreviewButton button={block.button} />;
  }
}

export function PromoPhonePreview({ draft, view }: { draft: PromoDraft; view: "home" | "article" }) {
  const faces = FONT_FACES[draft.theme.font];
  const accent = draft.theme.accent;
  const pinned = draft.body.flatMap((block) => (block.type === "button" && block.button.pinned ? [block.button] : []));
  const isAd = draft.kind === "ad";
  // The label the app will draw: the kind's default, none, or the console's words.
  const badge = draft.badge_mode === "hidden" ? null : draft.badge_mode === "custom" ? (draft.badge_text.trim() || null) : isAd ? "REKLAMA" : null;
  const defaultAd = isAd && draft.badge_mode === "auto";
  const articleChip = draft.badge_mode === "auto" && !isAd ? "JAXONGIRMAN TAVSIYA QILADI" : badge;

  if (view === "home") {
    return (
      <div className="pp-phone">
        <div className="pp-home">
          <div className="pp-home-head"><strong>Jaxongirman tavsiya qiladi</strong></div>
          <div className="pp-banner" style={{ aspectRatio: String(PROMO_BANNER_RATIO) }}>
            <Media url={draft.banner_url} kind={draft.banner_kind} className="pp-fill" />
            {draft.banner_style === "overlay" ? <div className="pp-banner-shade" /> : null}
            {badge ? (
              <span className={`pp-ad-chip${draft.banner_style === "image" ? " quiet" : ""}`}>
                {draft.banner_style === "overlay"
                  ? <>{defaultAd ? <Megaphone size={10} /> : null} {badge}{isAd && draft.sponsor ? ` · ${draft.sponsor}` : ""}</>
                  : badge}
              </span>
            ) : null}
            {draft.banner_style === "overlay" ? (
              <div className="pp-banner-copy">
                <div><strong>{draft.title || "Sarlavha"}</strong>{draft.subtitle ? <span>{draft.subtitle}</span> : null}</div>
                <i>{draft.action === "link" ? <ArrowUpRight size={15} /> : <ChevronRight size={15} />}</i>
              </div>
            ) : null}
          </div>
          <div className="pp-dots"><i className="on" /><i /><i /></div>
          <p className="pp-note">
            {draft.action === "link"
              ? `Bosilganda tashqi havola ochiladi: ${draft.link_url || "—"}`
              : "Bosilganda ichki maqola sahifasi ochiladi."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pp-phone">
      <div className="pp-scroll">
        <div className="pp-hero">
          <Media url={draft.hero_url ?? draft.banner_url} kind={draft.hero_url ? draft.hero_kind : draft.banner_kind} className="pp-fill" />
          <div className="pp-hero-shade" />
          <span className="pp-back"><ChevronLeft size={18} /></span>
        </div>
        <article className="pp-sheet" style={{ fontFamily: faces.body }}>
          <span className="pp-grip" />
          <div className="pp-kind">
            {articleChip ? <span className={isAd ? "ad" : ""}>{defaultAd ? <Megaphone size={11} /> : null} {articleChip}</span> : null}
            {isAd && draft.sponsor ? <em>{draft.sponsor}</em> : null}
          </div>
          <h2 style={{ fontFamily: faces.display }}>{draft.title || "Sarlavha"}</h2>
          {draft.subtitle ? <p className="pp-subtitle">{draft.subtitle}</p> : null}
          <span className="pp-rule" style={{ background: accent }} />
          <div className="pp-body">
            {draft.body.map((block) => <div key={block.id}><Block block={block} accent={accent} faces={faces} /></div>)}
            {draft.body.length === 0 ? <p className="pp-empty">Maqola bo‘sh. Chapdan bloklar qo‘shing: matn, rasm, video, tugma…</p> : null}
          </div>
        </article>
      </div>
      {pinned.length > 0 ? <div className="pp-dock">{pinned.map((button, index) => <PreviewButton key={index} button={button} />)}</div> : null}
    </div>
  );
}
