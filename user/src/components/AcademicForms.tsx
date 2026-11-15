import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Check, ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";

import {
  ORCID, PRESETS, STYLES, editSection, emptyAuthor, setSectionFigures, updateWork, uploadFigure,
  type Author, type CitationStyle, type Figure, type Layout, type Section, type Work,
} from "@/lib/academic";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The pieces of the scientific-work screen that are forms: who wrote it, how
 * the bibliography and the page look, a section the author corrects, and the
 * figures they add. Shared by the start of a work and its details tab, so the
 * two cannot drift.
 */

/* ------------------------------------------------------------- choices */

export function Chips<T extends string | number>({ options, value, onChange, label }: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const on = option === value;
        return (
          <Pressable key={String(option)} accessibilityRole="radio" accessibilityState={{ selected: on }}
            onPress={() => { onChange(option); void Haptics.selectionAsync(); }} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{label(option)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A choice with a line of explanation: an article's structure, a layout preset. */
export function OptionCards<T extends string>({ options, value, onChange, label, detail }: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
  detail: (value: T) => string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.cards}>
      {options.map((option) => {
        const on = option === value;
        return (
          <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: on }}
            onPress={() => { onChange(option); void Haptics.selectionAsync(); }} style={[styles.card, on && styles.cardOn]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.cardLabel, on && styles.cardLabelOn]}>{label(option)}</Text>
              <Text style={[styles.cardDetail, on && styles.cardDetailOn]}>{detail(option)}</Text>
            </View>
            {on ? <Check color={colors.onPrimary} size={18} strokeWidth={2.6} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------- authors */

export function AuthorsEditor({ authors, onChange }: { authors: Author[]; onChange: (authors: Author[]) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tools");
  const set = (at: number, patch: Partial<Author>) => onChange(authors.map((author, index) => (index === at ? { ...author, ...patch } : author)));
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.hint}>{t("academic.authorHint")}</Text>
      {authors.map((author, at) => (
        <View key={at} style={styles.author}>
          <View style={styles.authorHead}>
            <Text style={styles.authorNumber}>{at + 1}</Text>
            {authors.length > 1 ? (
              <Pressable accessibilityLabel={t("academic.removeAuthor")} hitSlop={8} onPress={() => onChange(authors.filter((_, index) => index !== at))}>
                <X color={colors.inkSoft} size={18} />
              </Pressable>
            ) : null}
          </View>
          <TextInput value={author.name} onChangeText={(name) => set(at, { name })} placeholder={t("academic.authorName")} placeholderTextColor={colors.inkSoft} style={styles.input} maxLength={120} />
          <TextInput value={author.affiliation} onChangeText={(affiliation) => set(at, { affiliation })} placeholder={t("academic.affiliation")} placeholderTextColor={colors.inkSoft} style={styles.input} maxLength={200} />
          <View style={styles.pair}>
            <TextInput value={author.orcid} onChangeText={(orcid) => set(at, { orcid })} placeholder={t("academic.orcid")} placeholderTextColor={colors.inkSoft}
              style={[styles.input, styles.half, author.orcid.trim() && !ORCID.test(author.orcid.trim().toUpperCase()) ? styles.invalid : null]}
              autoCapitalize="characters" autoCorrect={false} maxLength={19} />
            <TextInput value={author.email} onChangeText={(email) => set(at, { email })} placeholder={t("academic.email")} placeholderTextColor={colors.inkSoft}
              style={[styles.input, styles.half]} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" maxLength={120} />
          </View>
        </View>
      ))}
      {authors.length < 10 ? (
        <Pressable onPress={() => onChange([...authors, emptyAuthor()])} style={styles.add}>
          <Plus color={colors.primary} size={icon.sm} strokeWidth={2.2} />
          <Text style={styles.addText}>{t("academic.addAuthor")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A problem with the authors, said before the work is sent, or null. */
export function authorsProblem(authors: Author[], t: (key: string) => string): string | null {
  if (!authors.some((author) => author.name.trim())) return t("academic.needAuthor");
  if (authors.some((author) => author.orcid.trim() && !ORCID.test(author.orcid.trim().toUpperCase()))) return t("academic.badOrcid");
  return null;
}

/* -------------------------------------------------------------- layout */

export function LayoutEditor({ layout, onChange }: { layout: Layout; onChange: (layout: Layout) => void }) {
  const styles = useStyles();
  const { t } = useTranslation("tools");
  return (
    <View style={{ gap: spacing.sm }}>
      <OptionCards
        options={["uz", "journal", "apa"] as const}
        value={layout.preset}
        onChange={(preset) => onChange({ ...PRESETS[preset] })}
        label={(preset) => t(`academic.presets.${preset}.label`)}
        detail={(preset) => t(`academic.presets.${preset}.detail`)}
      />
      <Text style={styles.small}>{t("academic.fontSize")}</Text>
      <Chips options={[11, 12, 13, 14] as const} value={layout.fontSize as 11 | 12 | 13 | 14} onChange={(fontSize) => onChange({ ...layout, fontSize })} label={(size) => `${size} pt`} />
      <Text style={styles.small}>{t("academic.lineSpacing")}</Text>
      <Chips options={[1, 1.15, 1.5, 2] as const} value={layout.lineSpacing as 1 | 1.15 | 1.5 | 2} onChange={(lineSpacing) => onChange({ ...layout, lineSpacing })}
        label={(value) => String(value).replace(".", ",")} />
    </View>
  );
}

export function StyleChips({ value, onChange }: { value: CitationStyle; onChange: (style: CitationStyle) => void }) {
  const styles = useStyles();
  const { t } = useTranslation("tools");
  return (
    <View style={{ gap: spacing.xs }}>
      <Chips options={STYLES} value={value} onChange={onChange} label={(style) => (style === "gost" ? "GOST" : style === "apa" ? "APA" : style === "mla" ? "MLA" : style === "ieee" ? "IEEE" : style[0]!.toUpperCase() + style.slice(1))} />
      <Text style={styles.hint}>{t("academic.styleHint")}</Text>
    </View>
  );
}

/* ------------------------------------------------------------- figures */

function useSigned(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.storage.from("user-uploads").createSignedUrl(path, 1800).then(({ data }) => { if (alive) setUrl(data?.signedUrl ?? null); });
    return () => { alive = false; };
  }, [path]);
  return url;
}

function FigureRow({ figure, onCaption, onRemove }: { figure: Figure; onCaption: (caption: string) => void; onRemove: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tools");
  const url = useSigned(figure.path);
  const [caption, setCaption] = useState(figure.caption);
  return (
    <View style={styles.figure}>
      {url ? <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" /> : <View style={styles.thumb} />}
      <TextInput value={caption} onChangeText={setCaption} onEndEditing={() => caption !== figure.caption && onCaption(caption)}
        placeholder={t("academic.figureCaption")} placeholderTextColor={colors.inkSoft} style={[styles.input, { flex: 1 }]} maxLength={300} />
      <Pressable accessibilityLabel={t("academic.removeFigure")} hitSlop={8} onPress={onRemove}>
        <Trash2 color={colors.inkSoft} size={18} />
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------- a section */

/**
 * One section of the work: what was written, and — once it is — the author's
 * pencil and their figures. A section not yet written is the generator's.
 */
export function SectionCard({ section, workId, ownerId, onChanged }: {
  section: Section;
  workId: string;
  ownerId: string;
  onChanged: () => Promise<void> | void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tools");
  const [editing, setEditing] = useState(false);
  const [heading, setHeading] = useState(section.heading);
  const [body, setBody] = useState(section.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = section.status === "ready";
  const figured = ready && section.key !== "abstract" && section.key !== "keywords" && section.key !== "plan";

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function addFigure() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    await act(async () => {
      const figure = await uploadFigure(workId, ownerId, asset.uri, asset.width, asset.height);
      await setSectionFigures(section.id, [...section.figures, figure]);
    });
  }

  return (
    <View style={[styles.section, editing && styles.sectionEditing]}>
      <View style={styles.sectionHead}>
        {editing
          ? <TextInput value={heading} onChangeText={setHeading} style={[styles.input, { flex: 1 }]} placeholder={t("academic.headingLabel")} placeholderTextColor={colors.inkSoft} maxLength={200} />
          : <Text style={styles.sectionHeading}>{section.heading}</Text>}
        {section.status === "writing" ? <ActivityIndicator color={colors.primary} size="small" />
          : ready && !editing ? (
            <Pressable accessibilityLabel={t("academic.edit")} hitSlop={8} onPress={() => { setHeading(section.heading); setBody(section.body); setEditing(true); }} style={styles.iconButton}>
              <Pencil color={colors.primary} size={16} strokeWidth={2.2} />
            </Pressable>
          ) : !ready ? <Text style={styles.wait}>{t("academic.waiting")}</Text> : null}
      </View>

      {editing ? (
        <>
          <TextInput value={body} onChangeText={setBody} multiline style={[styles.input, styles.editor]} textAlignVertical="top" maxLength={24000} />
          <View style={styles.pair}>
            <Pressable disabled={busy} onPress={() => setEditing(false)} style={[styles.button, styles.half]}>
              <Text style={styles.buttonText}>{t("academic.cancel")}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => void act(async () => { await editSection(section.id, heading, body); setEditing(false); })}
              style={[styles.button, styles.buttonPrimary, styles.half]}>
              {busy ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{t("academic.save")}</Text>}
            </Pressable>
          </View>
        </>
      ) : section.body ? (
        <Text style={styles.body} numberOfLines={6}>{section.body}</Text>
      ) : null}
      {section.edited_at && !editing ? <Text style={styles.wait}>{t("academic.edited")}</Text> : null}

      {figured && !editing ? (
        <View style={{ gap: spacing.xs }}>
          {section.figures.map((figure, at) => (
            <FigureRow
              key={figure.path}
              figure={figure}
              onCaption={(caption) => void act(() => setSectionFigures(section.id, section.figures.map((each, index) => (index === at ? { ...each, caption } : each))))}
              onRemove={() => void act(() => setSectionFigures(section.id, section.figures.filter((_, index) => index !== at)))}
            />
          ))}
          {section.figures.length < 6 ? (
            <Pressable disabled={busy} onPress={() => void addFigure()} style={styles.add}>
              {busy ? <ActivityIndicator color={colors.primary} size="small" /> : <ImagePlus color={colors.primary} size={icon.sm} strokeWidth={2} />}
              <Text style={styles.addText}>{t("academic.addFigure")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------- details */

/** Everything around the prose, changeable after it is written: it takes effect on the next preview or file. */
export function DetailsEditor({ work, onSaved }: { work: Work; onSaved: () => Promise<void> | void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tools");
  const [topic, setTopic] = useState(work.topic);
  const [authors, setAuthors] = useState<Author[]>(work.authors.length ? work.authors : [emptyAuthor()]);
  const [udc, setUdc] = useState(work.udc);
  const [acknowledgements, setAcknowledgements] = useState(work.acknowledgements);
  const [funding, setFunding] = useState(work.funding);
  const [style, setStyle] = useState<CitationStyle>(work.citationStyle);
  const [layout, setLayout] = useState<Layout>(work.layout);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const problem = authorsProblem(authors, (key) => t(key as never));
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      await updateWork(work.id, { topic, authors, udc, acknowledgements, funding, citationStyle: style, layout });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNote(t("academic.saved"));
      await onSaved();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.hint}>{t("academic.detailsHint")}</Text>
      <Text style={styles.label}>{t("academic.headingLabel")}</Text>
      <TextInput value={topic} onChangeText={setTopic} style={styles.input} multiline maxLength={300} />
      <Text style={styles.label}>{t("academic.authors")}</Text>
      <AuthorsEditor authors={authors} onChange={setAuthors} />
      {work.kind === "article" ? (
        <>
          <Text style={styles.label}>{t("academic.udc")}</Text>
          <TextInput value={udc} onChangeText={setUdc} style={styles.input} placeholder="070.1" placeholderTextColor={colors.inkSoft} maxLength={60} />
        </>
      ) : null}
      <Text style={styles.label}>{t("academic.style")}</Text>
      <StyleChips value={style} onChange={setStyle} />
      <Text style={styles.label}>{t("academic.layout")}</Text>
      <LayoutEditor layout={layout} onChange={setLayout} />
      <Text style={styles.label}>{t("academic.acknowledgements")}</Text>
      <TextInput value={acknowledgements} onChangeText={setAcknowledgements} style={[styles.input, styles.tall]} multiline maxLength={3000} />
      <Text style={styles.label}>{t("academic.funding")}</Text>
      <TextInput value={funding} onChangeText={setFunding} style={[styles.input, styles.tall]} multiline maxLength={3000} />
      <Text style={styles.hint}>{t("academic.fundingHint")}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {note && !error ? <Text style={styles.note}>{note}</Text> : null}
      <Pressable disabled={busy} onPress={() => void save()} style={[styles.button, styles.buttonPrimary, { marginTop: spacing.sm }]}>
        {busy ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{t("academic.saveDetails")}</Text>}
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  label: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.md },
  small: { ...typography.caption, color: colors.inkSoft },
  hint: { ...typography.caption, color: colors.inkSoft },
  note: { ...typography.caption, color: colors.success },
  error: { ...typography.caption, color: colors.danger },
  input: {
    ...typography.body, color: colors.ink, minHeight: 46, paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted,
  },
  invalid: { borderColor: colors.danger },
  tall: { minHeight: 88, textAlignVertical: "top" },
  editor: { minHeight: 260, fontSize: 15, lineHeight: 22 },
  pair: { flexDirection: "row", gap: spacing.sm },
  half: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.ink },
  chipTextOn: { color: colors.onPrimary },
  cards: { gap: spacing.xs },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  cardLabel: { ...typography.body, fontFamily: "JaxongirmanSans_700Bold", color: colors.ink },
  cardLabelOn: { color: colors.onPrimary },
  cardDetail: { ...typography.caption, color: colors.inkSoft },
  cardDetailOn: { color: "rgba(255,255,255,0.82)" },
  author: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  authorHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  authorNumber: { ...typography.caption, fontFamily: "JaxongirmanSans_800ExtraBold", color: colors.primaryDeep },
  add: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.primary },
  addText: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.primary },
  section: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: 8 },
  sectionEditing: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  sectionHeading: { ...typography.body, fontFamily: "JaxongirmanSans_700Bold", flex: 1, color: colors.ink },
  iconButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  wait: { ...typography.caption, color: colors.inkSoft },
  body: { ...typography.caption, color: colors.inkMuted, lineHeight: 19 },
  figure: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  thumb: { width: 54, height: 54, borderRadius: 10, backgroundColor: colors.border },
  button: { minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonText: { ...typography.body, fontFamily: "JaxongirmanSans_700Bold", color: colors.primaryDeep },
}));
