import type { Json, Tables } from "@jaxongirman/types";
import {
  ArrowUpDown, Blend, Bold, Check, ChevronDown, ChevronsDown, ChevronsUp, Image as ImageIcon, Italic, Layers, List,
  Minus, Plus, Send, Sheet, SquareRoundCorner, Strikethrough, TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart, Type,
  Underline, WandSparkles, type LucideIcon,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ChartDataEditor, TableDataEditor } from "@/components/DataEditor";
import { FontPicker, type PickedFont } from "@/components/FontPicker";
import { slugOfFaceId } from "@/lib/fontLibrary";
import { rememberFont, recentFonts } from "@/lib/recentFonts";
import {
  BASE_SWATCHES, DEFAULT_FONT_SIZE, FONTS, TEXT_EFFECTS, alignmentOf, bag, effectOf, effectTextStyle,
  fontOptionOf, formatSize, hasBullets, isBoldStyle, isItalic, isStrikethrough, isUnderline, lineHeightRatio,
  nextAlignment, nextTextCase, num, str, textCaseOf, toggleBullets, withFont, withFontSize, withLineHeightRatio,
  type Alignment, type StyleBag, fontNameOf,
} from "@/lib/textStyle";
import { icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Element = Tables<"slide_elements">;

export type ToolPanel = "text" | "font" | "color" | "spacing" | "opacity" | "effects" | "layer" | "corner" | "data" | null;

type Props = {
  element: Element;
  /** Colours already used on the slide, offered first in the colour panel. */
  swatches: string[];
  panel: ToolPanel;
  onPanel: (panel: ToolPanel) => void;
  onStyle: (style: StyleBag) => void;
  onContent: (content: { [key: string]: Json | undefined }) => void;
  onElement: (patch: { opacity?: number; z_index?: number }) => void;
  onReplaceImage: () => void;
  onChooseTelegramImage: () => void;
  zRange: { min: number; max: number };
};

const ALIGN_ICONS: Record<Alignment, LucideIcon> = {
  left: TextAlignStart,
  center: TextAlignCenter,
  right: TextAlignEnd,
  justify: TextAlignJustify,
};

const ALIGN_LABELS: Record<Alignment, string> = {
  left: "Chapga",
  center: "Markazga",
  right: "O‘ngga",
  justify: "Kenglik bo‘yicha",
};

const CASE_LABELS = { none: "Odatiy", uppercase: "BOSH HARF", lowercase: "kichik harf" } as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * The dock that appears under the slide while an element is selected: a
 * scrolling row of formatting tools, with an expanding panel above it for the
 * ones that need more than a tap.
 */
export function ElementToolbar({ element, swatches, panel, onPanel, onStyle, onContent, onElement, onReplaceImage, onChooseTelegramImage, zRange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { if (pickerOpen) void recentFonts().then(setRecent); }, [pickerOpen]);
  const { colors } = useTheme();
  const styles = useStyles();
  const style = bag(element.style);
  const content = bag(element.content);
  const isText = element.type === "text";
  const colorKey = element.type === "shape" ? "fill" : "color";
  const colorValue = str(style[colorKey], isText ? colors.ink : colors.primary);
  const fontOption = fontOptionOf(style);
  const bold = isBoldStyle(style);
  const fontSize = num(style.fontSize, DEFAULT_FONT_SIZE);
  const alignment = alignmentOf(style);
  const textCase = textCaseOf(style);
  const effect = effectOf(style);
  const text = str(content.text);
  const canColor = isText || element.type === "shape" || element.type === "icon" || element.type === "line";
  // Shapes and picture frames are the two things whose corners can be rounded.
  const canRound = element.type === "shape" || element.type === "image";
  const maxRadius = Math.round(Math.min(element.width, element.height) / 2);
  const cornerRadius = Math.min(num(style.borderRadius, 0), maxRadius);
  const isVideo = str(content.kind) === "video";
  // A chart's numbers and a table's cells are the two things a reader will want
  // to correct on the slide itself rather than by regenerating the deck.
  const hasData = element.type === "chart" || element.type === "table";

  const toggle = (key: ToolPanel) => onPanel(panel === key ? null : key);
  const patch = (next: StyleBag) => onStyle(next);
  const setRadius = (value: number) => patch({ ...style, borderRadius: clamp(Math.round(value), 0, maxRadius) });

  return (
    <View style={styles.dock}>
      {panel ? (
        <View style={styles.panel}>
          {panel === "text" ? (
            <TextPanel key={element.id} value={text} onChange={(next) => onContent({ ...content, text: next })} onDone={() => onPanel(null)} />
          ) : null}

          {panel === "data" && element.type === "chart" ? (
            <ChartDataEditor content={content} onChange={onContent} />
          ) : null}

          {panel === "data" && element.type === "table" ? (
            <TableDataEditor content={content} onChange={onContent} />
          ) : null}

          {panel === "font" ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.panelRow}>
              {/* The library first: four bundled faces are what this deck can
                  draw without a download, and everything else is behind here. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Barcha shriftlar"
                onPress={() => setPickerOpen(true)}
                style={[styles.fontCard, styles.fontCardLibrary]}
              >
                <Type color={colors.primary} size={20} strokeWidth={2} />
                <Text numberOfLines={1} style={styles.fontName}>Kutubxona</Text>
              </Pressable>
              {FONTS.map((option) => {
                const active = option.key === fontOption.key;
                return (
                  <Pressable key={option.key} onPress={() => patch(withFont(style, option, bold))} style={[styles.fontCard, active && styles.fontCardActive]}>
                    <Text numberOfLines={1} style={[styles.fontSample, { fontFamily: option.regular }]}>Aa</Text>
                    <Text numberOfLines={1} style={[styles.fontName, active && styles.activeText]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {panel === "color" ? (
            <View style={styles.swatchGrid}>
              {[...swatches, ...BASE_SWATCHES.filter((hex) => !swatches.includes(hex))].map((hex) => (
                <Pressable key={hex} accessibilityLabel={hex} onPress={() => patch({ ...style, [colorKey]: hex })} style={[styles.swatch, { backgroundColor: hex }]}>
                  {hex.toUpperCase() === colorValue.toUpperCase() ? (
                    <Check color={hex.toUpperCase() === "#FFFFFF" ? colors.ink : colors.onPrimary} size={icon.sm} strokeWidth={icon.strokeBold} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          {panel === "spacing" ? (
            <View style={styles.panelColumn}>
              <PanelRow label="Qator oralig‘i" value={lineHeightRatio(style).toFixed(2)}>
                <Stepper
                  onMinus={() => patch(withLineHeightRatio(style, lineHeightRatio(style) - 0.05))}
                  onPlus={() => patch(withLineHeightRatio(style, lineHeightRatio(style) + 0.05))}
                />
              </PanelRow>
              <PanelRow label="Harf oralig‘i" value={formatSize(num(style.letterSpacing, 0))}>
                <Stepper
                  onMinus={() => patch({ ...style, letterSpacing: Math.round((num(style.letterSpacing, 0) - 0.5) * 10) / 10 })}
                  onPlus={() => patch({ ...style, letterSpacing: Math.round((num(style.letterSpacing, 0) + 0.5) * 10) / 10 })}
                />
              </PanelRow>
            </View>
          ) : null}

          {panel === "opacity" ? (
            <View style={styles.panelColumn}>
              <PanelRow label="Shaffoflik" value={`${Math.round(element.opacity * 100)}%`}>
                <Stepper
                  onMinus={() => onElement({ opacity: clamp(Math.round((element.opacity - 0.05) * 100) / 100, 0.05, 1) })}
                  onPlus={() => onElement({ opacity: clamp(Math.round((element.opacity + 0.05) * 100) / 100, 0.05, 1) })}
                />
              </PanelRow>
              <View style={styles.panelRow}>
                {[1, 0.75, 0.5, 0.25].map((value) => (
                  <Pressable key={value} onPress={() => onElement({ opacity: value })} style={[styles.chip, Math.abs(element.opacity - value) < 0.01 && styles.chipActive]}>
                    <Text style={[styles.chipText, Math.abs(element.opacity - value) < 0.01 && styles.activeText]}>{value * 100}%</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {panel === "effects" ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.panelRow}>
              {TEXT_EFFECTS.map((option) => {
                const active = option.key === effect;
                return (
                  <Pressable key={option.key} onPress={() => patch({ ...style, textEffect: option.key })} style={[styles.fontCard, active && styles.fontCardActive]}>
                    <Text style={[styles.effectSample, effectTextStyle(option.key, colors.primary)]}>Aa</Text>
                    <Text numberOfLines={1} style={[styles.fontName, active && styles.activeText]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {panel === "corner" ? (
            <View style={styles.panelColumn}>
              <PanelRow label="Burchak radiusi" value={String(cornerRadius)}>
                <Stepper onMinus={() => setRadius(cornerRadius - 4)} onPlus={() => setRadius(cornerRadius + 4)} />
              </PanelRow>
              <View style={styles.panelRow}>
                {[{ label: "To‘g‘ri", value: 0 }, { label: "Yumshoq", value: 12 }, { label: "Dumaloq", value: 32 }, { label: "To‘liq", value: maxRadius }].map((preset) => (
                  <Pressable key={preset.label} onPress={() => setRadius(preset.value)} style={[styles.chip, cornerRadius === Math.min(preset.value, maxRadius) && styles.chipActive]}>
                    <Text style={[styles.chipText, cornerRadius === Math.min(preset.value, maxRadius) && styles.activeText]}>{preset.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {panel === "layer" ? (
            <View style={styles.panelRow}>
              <LayerButton icon={ChevronsUp} label="Eng oldinga" onPress={() => onElement({ z_index: zRange.max + 1 })} />
              <LayerButton icon={ChevronsUp} label="Oldinga" onPress={() => onElement({ z_index: element.z_index + 1 })} />
              <LayerButton icon={ChevronsDown} label="Orqaga" onPress={() => onElement({ z_index: element.z_index - 1 })} />
              <LayerButton icon={ChevronsDown} label="Eng orqaga" onPress={() => onElement({ z_index: zRange.min - 1 })} />
            </View>
          ) : null}
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.bar}>
        {hasData ? (
          <Tool
            icon={Sheet}
            label={element.type === "chart" ? "Diagramma ma’lumoti" : "Jadval ma’lumoti"}
            active={panel === "data"}
            onPress={() => toggle("data")}
          />
        ) : null}

        {isText ? (
          <>
            <Tool icon={Type} label="Matnni tahrirlash" active={panel === "text"} onPress={() => toggle("text")} />
            <Pressable onPress={() => toggle("font")} style={[styles.chip, panel === "font" && styles.chipActive]}>
              <Text numberOfLines={1} style={[styles.chipText, styles.fontChipText]}>{fontOption.label}</Text>
              <ChevronDown color={colors.inkMuted} size={icon.sm} strokeWidth={icon.stroke} />
            </Pressable>
            <View style={styles.sizeChip}>
              <Pressable accessibilityLabel="Kichraytirish" hitSlop={6} onPress={() => patch(withFontSize(style, fontSize - 1))} style={styles.sizeButton}>
                <Minus color={colors.ink} size={icon.sm} strokeWidth={icon.strokeBold} />
              </Pressable>
              <Text style={styles.sizeValue}>{formatSize(fontSize)}</Text>
              <Pressable accessibilityLabel="Kattalashtirish" hitSlop={6} onPress={() => patch(withFontSize(style, fontSize + 1))} style={styles.sizeButton}>
                <Plus color={colors.ink} size={icon.sm} strokeWidth={icon.strokeBold} />
              </Pressable>
            </View>
            <Pressable accessibilityLabel="Rang" onPress={() => toggle("color")} style={[styles.tool, panel === "color" && styles.toolActive]}>
              <Text style={styles.colorGlyph}>A</Text>
              <View style={[styles.colorBar, { backgroundColor: colorValue }]} />
            </Pressable>

            <View style={styles.divider} />

            <Tool icon={Bold} label="Qalin" active={bold} disabled={fontOption.regular === fontOption.bold} onPress={() => patch(withFont(style, fontOption, !bold))} />
            <Tool icon={Italic} label="Kursiv" active={isItalic(style)} onPress={() => patch({ ...style, fontStyle: isItalic(style) ? "normal" : "italic" })} />
            <Tool icon={Underline} label="Tagi chizilgan" active={isUnderline(style)} onPress={() => patch({ ...style, underline: !isUnderline(style) })} />
            <Tool icon={Strikethrough} label="O‘chirilgan" active={isStrikethrough(style)} onPress={() => patch({ ...style, strikethrough: !isStrikethrough(style) })} />
            <Pressable
              accessibilityLabel={`Harf holati: ${CASE_LABELS[textCase]}`}
              onPress={() => patch({ ...style, textTransform: nextTextCase(textCase) })}
              style={[styles.tool, textCase !== "none" && styles.toolActive]}
            >
              <Text style={[styles.caseGlyph, textCase !== "none" && styles.activeText]}>aA</Text>
            </Pressable>

            <View style={styles.divider} />

            <Tool
              icon={ALIGN_ICONS[alignment]}
              label={`Tekislash: ${ALIGN_LABELS[alignment]}`}
              active={alignment !== "left"}
              onPress={() => patch({ ...style, textAlign: nextAlignment(alignment) })}
            />
            <Tool icon={List} label="Ro‘yxat" active={hasBullets(text)} onPress={() => onContent({ ...content, text: toggleBullets(text) })} />
            <Tool icon={ArrowUpDown} label="Oraliqlar" active={panel === "spacing"} onPress={() => toggle("spacing")} />
          </>
        ) : null}

        {!isText && canColor ? (
          <Pressable accessibilityLabel="Rang" onPress={() => toggle("color")} style={[styles.chip, panel === "color" && styles.chipActive]}>
            <View style={[styles.colorDot, { backgroundColor: colorValue }]} />
            <Text style={styles.chipText}>Rang</Text>
          </Pressable>
        ) : null}

        {element.type === "image" ? (
          <>
            <Pressable onPress={onReplaceImage} style={styles.chip}>
              <ImageIcon color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} />
              <Text style={styles.chipText}>{isVideo ? "Videoni almashtirish" : "Rasmni almashtirish"}</Text>
            </Pressable>
            {!isVideo ? (
              <Pressable accessibilityLabel="Telegram orqali rasm tanlash" onPress={onChooseTelegramImage} style={styles.chip}>
                <Send color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} />
                <Text style={styles.chipText}>Telegram orqali rasm tanlash</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {canRound ? <Tool icon={SquareRoundCorner} label="Burchak radiusi" active={panel === "corner"} onPress={() => toggle("corner")} /> : null}

        {isText ? <View style={styles.divider} /> : null}

        <Tool icon={Blend} label="Shaffoflik" active={panel === "opacity"} onPress={() => toggle("opacity")} />
        {isText ? (
          <Pressable onPress={() => toggle("effects")} style={[styles.chip, panel === "effects" && styles.chipActive]}>
            <WandSparkles color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} />
            <Text style={styles.chipText}>Effektlar</Text>
          </Pressable>
        ) : null}
        <Tool icon={Layers} label="Qatlam" active={panel === "layer"} onPress={() => toggle("layer")} />
      </ScrollView>

      {/**
        * A whole sheet rather than another row of chips: choosing out of a
        * library is a different act from switching between four faces, and
        * every row in it is a font that has to be fetched before it can be read.
        */}
      <FontPicker
        visible={pickerOpen}
        current={slugOfFaceId(fontNameOf(style))}
        weight={bold ? 700 : 400}
        italic={isItalic(style)}
        recent={recent}
        onClose={() => setPickerOpen(false)}
        onPick={(picked: PickedFont) => {
          setPickerOpen(false);
          // No registered name means the face never arrived; leaving the style
          // alone is better than pointing it at something that cannot draw.
          if (!picked.faceName) return;
          void rememberFont(picked.slug).then(setRecent);
          patch({
            ...style,
            fontFamily: picked.faceName,
            // The family as a person would write it, kept beside the runtime
            // name so the exporter writes "Montserrat" into the PPTX rather
            // than the identifier this app registered the file under.
            fontDisplayName: picked.family,
            fontWeight: String(picked.weight),
            fontStyle: picked.italic ? "italic" : "normal",
          });
        }}
      />
    </View>
  );
}

function Tool({ icon: Icon, label, active = false, disabled = false, onPress }: { icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={[styles.tool, active && styles.toolActive, disabled && styles.toolDisabled]}>
      <Icon color={active ? colors.primary : colors.ink} size={icon.md} strokeWidth={active ? icon.strokeBold : icon.stroke} />
    </Pressable>
  );
}

function Stepper({ onMinus, onPlus }: { onMinus: () => void; onPlus: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.stepper}>
      <Pressable accessibilityLabel="Kamaytirish" hitSlop={6} onPress={onMinus} style={styles.sizeButton}>
        <Minus color={colors.ink} size={icon.sm} strokeWidth={icon.strokeBold} />
      </Pressable>
      <Pressable accessibilityLabel="Oshirish" hitSlop={6} onPress={onPlus} style={styles.sizeButton}>
        <Plus color={colors.ink} size={icon.sm} strokeWidth={icon.strokeBold} />
      </Pressable>
    </View>
  );
}

function PanelRow({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.panelLine}>
      <Text style={styles.panelLabel}>{label}</Text>
      <Text style={styles.panelValue}>{value}</Text>
      {children}
    </View>
  );
}

function LayerButton({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={styles.chip}>
      <Icon color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} />
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

/** Held locally while typing so every keystroke does not hit the server. */
function TextPanel({ value, onChange, onDone }: { value: string; onChange: (next: string) => void; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [draft, setDraft] = useState(value);
  return (
    <View style={styles.panelColumn}>
      <TextInput
        autoFocus
        multiline
        onChangeText={setDraft}
        placeholder="Matnni yozing…"
        placeholderTextColor={colors.inkSoft}
        style={styles.textEditor}
        value={draft}
      />
      <Pressable
        onPress={() => { if (draft !== value) onChange(draft); onDone(); }}
        style={styles.doneButton}
      >
        <Check color={colors.onPrimary} size={icon.sm} strokeWidth={icon.strokeBold} />
        <Text style={styles.doneText}>Tayyor</Text>
      </Pressable>
    </View>

  );
}

const useStyles = makeStyles((colors) => ({
  dock: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden", ...shadow },
  bar: { alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  tool: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  toolActive: { backgroundColor: colors.primarySoft },
  toolDisabled: { opacity: 0.3 },
  divider: { width: 1, height: 24, marginHorizontal: spacing.xs, backgroundColor: colors.border },

  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { ...typography.caption, color: colors.ink },
  fontChipText: { maxWidth: 96 },
  activeText: { color: colors.primary },

  sizeChip: { flexDirection: "row", alignItems: "center", height: 40, paddingHorizontal: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  sizeButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  sizeValue: { ...typography.caption, color: colors.ink, minWidth: 34, textAlign: "center" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 3 },

  colorGlyph: { fontFamily: "Manrope_700Bold", fontSize: 17, color: colors.ink, lineHeight: 20 },
  colorBar: { width: 22, height: 4, borderRadius: 2, marginTop: 2 },
  colorDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.border },
  caseGlyph: { fontFamily: "Manrope_700Bold", fontSize: 15, color: colors.ink },

  panel: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  panelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingRight: spacing.md },
  panelColumn: { gap: spacing.sm },
  panelLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  panelLabel: { ...typography.caption, color: colors.inkMuted, flex: 1 },
  panelValue: { ...typography.caption, color: colors.ink, minWidth: 44, textAlign: "right" },

  fontCardLibrary: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  fontCard: { minWidth: 86, alignItems: "center", gap: 2, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  fontCardActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  fontSample: { fontSize: 22, color: colors.ink },
  effectSample: { fontFamily: "Manrope_700Bold", fontSize: 22, color: colors.primary },
  fontName: { ...typography.caption, color: colors.inkMuted, maxWidth: 96 },

  swatchGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },

  textEditor: { ...typography.body, color: colors.ink, minHeight: 84, maxHeight: 160, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, padding: spacing.md },
  doneButton: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.primary },
  doneText: { ...typography.caption, color: colors.onPrimary },
}));
