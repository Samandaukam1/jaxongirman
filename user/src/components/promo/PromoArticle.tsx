import { parseInline, type PromoBlock, type PromoButton, type PromoCalloutTone, type PromoTheme } from "@jaxongirman/types";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Text, View, type StyleProp, type TextStyle } from "react-native";

import { PromoAudioBlock, PromoVideoBlock } from "@/components/promo/PromoMedia";
import { PromoButtonView } from "@/components/promo/PromoButtonView";
import type { PromoFaces } from "@/components/promo/promoFonts";
import { openPromoUrl } from "@/lib/promos";
import { withAlpha } from "@/theme/color";
import { radius, spacing } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Props = {
  blocks: PromoBlock[];
  theme: PromoTheme;
  faces: PromoFaces;
  onButton: (button: PromoButton) => void;
};

/** The buttons the console pinned to the bottom of the screen, in article order. */
export function pinnedButtons(blocks: PromoBlock[]): PromoButton[] {
  return blocks.flatMap((block) => (block.type === "button" && block.button.pinned && block.button.label ? [block.button] : []));
}

/**
 * Formatted text: bold, italic, underline, strike, colour, highlight and links,
 * as nested runs of one paragraph.
 *
 * Bold and italic pick the face's own cut where it has one (Lora has all four);
 * a face without a true italic is slanted instead.
 */
export function RichText({ source, style, faces, accent, selectable = true }: {
  source: string;
  style: StyleProp<TextStyle>;
  faces: PromoFaces;
  accent: string;
  selectable?: boolean;
}) {
  const router = useRouter();
  const spans = parseInline(source);
  return (
    <Text style={style} selectable={selectable}>
      {spans.map((span, index) => {
        const family = span.bold && span.italic ? faces.bodyBoldItalic : span.bold ? faces.bodyBold : span.italic ? faces.bodyItalic : undefined;
        const decoration = [span.underline || span.href ? "underline" : null, span.strike ? "line-through" : null].filter(Boolean).join(" ");
        return (
          <Text
            key={index}
            onPress={span.href ? () => openPromoUrl(span.href!, router) : undefined}
            suppressHighlighting={!span.href}
            style={[
              family ? { fontFamily: family } : null,
              span.italic && faces.synthesizeItalic ? { fontStyle: "italic" } : null,
              decoration ? { textDecorationLine: decoration as TextStyle["textDecorationLine"] } : null,
              span.href ? { color: accent, textDecorationColor: withAlpha(accent, 0.5) } : null,
              span.color ? { color: span.color } : null,
              span.highlight ? { backgroundColor: withAlpha(span.highlight, 0.55) } : null,
            ]}
          >
            {span.text}
          </Text>
        );
      })}
    </Text>
  );
}

const CALLOUT: Record<PromoCalloutTone, { ink: string; ground: string }> = {
  brand: { ink: "#6C34C9", ground: "#6C34C9" },
  gold: { ink: "#B7791F", ground: "#F6C453" },
  success: { ink: "#047857", ground: "#34D399" },
  danger: { ink: "#BE123C", ground: "#FB7185" },
};

/**
 * An article, block by block, in the order it was written.
 *
 * Every block is drawn on the theme's surfaces so a night-mode reader gets a
 * night-mode article; the console's colours are used where the writer chose
 * one (text colour, highlight, button, accent).
 */
export function PromoArticle({ blocks, theme, faces, onButton }: Props) {
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const accent = theme.accent;
  const body: TextStyle = { ...styles.body, fontFamily: faces.body };

  return (
    <View style={styles.stack}>
      {blocks.map((block) => {
        switch (block.type) {
          case "heading":
            if (!block.text.trim()) return null;
            return (
              <Text key={block.id} style={[block.level === 1 ? styles.h1 : styles.h2, { fontFamily: faces.display }]}>
                {block.text}
              </Text>
            );
          case "text":
            if (!block.text.trim()) return null;
            return (
              <RichText
                key={block.id}
                source={block.text}
                faces={faces}
                accent={accent}
                style={[body, block.size === "large" ? styles.lead : {}, { textAlign: block.align }]}
              />
            );
          case "quote":
            if (!block.text.trim()) return null;
            return (
              <View key={block.id} style={[styles.quote, { borderLeftColor: accent }]}>
                <Text style={[styles.quoteMark, { color: withAlpha(accent, 0.35), fontFamily: faces.display }]}>“</Text>
                <RichText source={block.text} faces={faces} accent={accent} style={[styles.quoteText, { fontFamily: faces.quote }]} />
                {block.cite ? <Text style={styles.cite}>— {block.cite}</Text> : null}
              </View>
            );
          case "callout": {
            if (!block.text.trim()) return null;
            const tone = CALLOUT[block.tone];
            return (
              <View key={block.id} style={[styles.callout, { backgroundColor: withAlpha(tone.ground, scheme === "dark" ? 0.18 : 0.12), borderColor: withAlpha(tone.ground, 0.4) }]}>
                <View style={[styles.calloutBar, { backgroundColor: tone.ground }]} />
                <RichText source={block.text} faces={faces} accent={accent} style={[body, styles.calloutText, scheme === "dark" ? null : { color: tone.ink }]} />
              </View>
            );
          }
          case "image":
            if (!block.url) return null;
            return (
              <View key={block.id} style={styles.figure}>
                <ArticleImage uri={block.url} />
                {block.caption ? <Text style={styles.caption}>{block.caption}</Text> : null}
              </View>
            );
          case "video":
            if (!block.url) return null;
            return (
              <View key={block.id} style={styles.figure}>
                <PromoVideoBlock uri={block.url} style={styles.video} />
                {block.caption ? <Text style={styles.caption}>{block.caption}</Text> : null}
              </View>
            );
          case "audio":
            if (!block.url) return null;
            return (
              <View key={block.id} style={styles.figure}>
                <PromoAudioBlock uri={block.url} title={block.title} accent={accent} />
                {block.caption ? <Text style={styles.caption}>{block.caption}</Text> : null}
              </View>
            );
          case "list": {
            const items = block.items.filter((item) => item.trim());
            if (items.length === 0) return null;
            return (
              <View key={block.id} style={styles.list}>
                {items.map((item, index) => (
                  <View key={index} style={styles.listRow}>
                    {block.ordered ? (
                      <Text style={[styles.listNumber, { color: accent, fontFamily: faces.display }]}>{index + 1}.</Text>
                    ) : (
                      <View style={[styles.bullet, { backgroundColor: accent }]} />
                    )}
                    <RichText source={item} faces={faces} accent={accent} style={[body, styles.listText]} />
                  </View>
                ))}
              </View>
            );
          }
          case "divider":
            return (
              <View key={block.id} style={styles.divider}>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                <View style={[styles.dividerGem, { backgroundColor: accent }]} />
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              </View>
            );
          case "button":
            if (block.button.pinned || !block.button.label) return null;
            return <PromoButtonView key={block.id} button={block.button} onPress={() => onButton(block.button)} />;
          default:
            return null;
        }
      })}
    </View>
  );
}

/** A picture at its own proportions, measured once it loads; 16:9 until then. */
function ArticleImage({ uri }: { uri: string }) {
  const styles = useStyles();
  const [ratio, setRatio] = useState(16 / 9);
  // Asked of the image cache rather than read from `onLoad`, whose event has
  // no `source` on the web.
  useEffect(() => {
    let live = true;
    Image.getSize(uri, (width, height) => {
      if (live && width > 0 && height > 0) setRatio(Math.min(Math.max(width / height, 0.5), 3));
    }, () => undefined);
    return () => { live = false; };
  }, [uri]);
  return (
    <Image
      source={{ uri }}
      style={[styles.image, { aspectRatio: ratio }]}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
    />
  );
}

const useStyles = makeStyles((colors) => ({
  stack: { gap: spacing.lg + 2 },
  h1: { fontSize: 28, lineHeight: 35, color: colors.ink, letterSpacing: -0.4, marginTop: spacing.sm },
  h2: { fontSize: 22, lineHeight: 29, color: colors.ink, letterSpacing: -0.2, marginTop: spacing.xs },
  body: { fontSize: 17, lineHeight: 28, color: colors.ink },
  lead: { fontSize: 20, lineHeight: 31 },
  quote: { borderLeftWidth: 3, paddingLeft: spacing.lg, paddingVertical: spacing.xs, gap: spacing.xs },
  quoteMark: { fontSize: 64, lineHeight: 64, marginBottom: -30, marginTop: -6 },
  quoteText: { fontSize: 21, lineHeight: 31, color: colors.ink },
  cite: { fontFamily: "Manrope_600SemiBold", fontSize: 13, color: colors.inkMuted, letterSpacing: 0.3 },
  callout: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  calloutBar: { width: 4, borderRadius: 2 },
  calloutText: { flex: 1, fontSize: 16, lineHeight: 25 },
  figure: { gap: spacing.sm },
  image: { width: "100%", borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  video: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#000" },
  caption: { fontFamily: "Manrope_500Medium", fontSize: 12.5, lineHeight: 18, color: colors.inkSoft, textAlign: "center" },
  list: { gap: spacing.sm },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  bullet: { width: 7, height: 7, borderRadius: 4, marginTop: 11 },
  listNumber: { fontSize: 17, lineHeight: 28, minWidth: 22 },
  listText: { flex: 1 },
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.sm },
  dividerLine: { flex: 1, height: 1 },
  dividerGem: { width: 8, height: 8, borderRadius: 2, transform: [{ rotate: "45deg" }] },
}));
