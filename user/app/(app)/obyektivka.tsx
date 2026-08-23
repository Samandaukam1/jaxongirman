import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Check, Download, Plus, Trash2, User as UserIcon } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { asErrorMessage } from "@/lib/format";
import {
  FIELDS, RELATIVE_COLUMNS, objectiveFile, openObjective, saveObjective,
  type ObjectiveDoc, type RelativeRow, type WorkRow,
} from "@/lib/objective";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

/**
 * Filling in an obyektivka.
 *
 * The document is a fixed form, so the screen is the form rather than a page of
 * generic inputs: the same labels, in the same order, paired the way the paper
 * pairs them. Somebody who has filled one in by hand recognises where they are.
 *
 * Saving is on a timer rather than on a button. This is twenty answers typed
 * over several sittings, often with the paper original in the other hand, and
 * losing them to a back-swipe is the failure that makes a person not come back.
 */

const EMPTY_WORK: WorkRow = { period: "", detail: "" };
const EMPTY_RELATIVE: RelativeRow = { relation: "", name: "", born: "", work: "", address: "" };

export default function ObyektivkaScreen() {
  const [doc, setDoc] = useState<ObjectiveDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"docx" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** One input per field, so a tap on the document can put the cursor in it. */
  const inputs = useRef<Record<string, TextInput | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDoc(await openObjective());
      setError(null);
    } catch (readError) {
      setError(asErrorMessage(readError));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /**
   * Written a second after the last keystroke.
   *
   * Long enough that a sentence is one write rather than forty, short enough
   * that closing the app straight after typing still keeps what was typed.
   */
  const change = useCallback((next: ObjectiveDoc) => {
    setDoc(next);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void saveObjective(next)
        .then(() => setSaved(true))
        .catch((saveError) => setError(asErrorMessage(saveError)));
    }, 1000);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function download(format: "docx" | "pdf") {
    if (!doc) return;
    setBusy(format); setError(null);
    try {
      // Saved first: the server renders what is stored, not what is on screen.
      await saveObjective(doc);
      const url = await objectiveFile(doc.id, format);
      if (Platform.OS === "web") { window.open(url, "_blank", "noopener,noreferrer"); return; }
      const { uri } = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}obyektivka.${format}`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          dialogTitle: "Obyektivka",
        });
      }
    } catch (downloadError) {
      setError(asErrorMessage(downloadError));
    } finally {
      setBusy(null);
    }
  }

  if (loading || !doc) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Obyektivka" />
        <View style={styles.centered}>
          {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} size="large" />}
        </View>
      </View>
    );
  }

  const field = (id: (typeof FIELDS)[number]["id"], value: string) =>
    change({ ...doc, fields: { ...doc.fields, [id]: value } });

  const pairs: (typeof FIELDS)[number][][] = [];
  for (let index = 0; index < FIELDS.length; index += 1) {
    const entry = FIELDS[index]!;
    const next = FIELDS[index + 1];
    if (entry.layout === "pair" && next?.layout === "pair") { pairs.push([entry, next]); index += 1; }
    else pairs.push([entry]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScreenHeader title="Obyektivka" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/**
          * The document as it will be, above the form that fills it.
          *
          * A form of twenty inputs tells you what you have typed; it does not
          * tell you what you are going to hand in. Tapping a line here puts the
          * cursor in the field behind it, so the document is also the way you
          * navigate the form — which is how somebody with the paper original in
          * their other hand actually works: they read down the page.
          */}
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>MA’LUMOTNOMA</Text>
          <Text style={styles.sheetName}>{doc.fullName || "—"}</Text>
          <View style={styles.sheetRule} />
          {FIELDS.map((entry) => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`${entry.label} maydoniga o‘tish`}
              onPress={() => inputs.current[entry.id]?.focus()}
              style={styles.sheetRow}
            >
              <Text style={styles.sheetLabel}>{entry.label}:</Text>
              <Text style={[styles.sheetValue, !(doc.fields[entry.id] ?? "").trim() && styles.sheetEmpty]} numberOfLines={2}>
                {(doc.fields[entry.id] ?? "").trim() || "—"}
              </Text>
            </Pressable>
          ))}
          {doc.work.length > 0 ? (
            <>
              <Text style={styles.sheetHeading}>MEHNAT FAOLIYATI</Text>
              {doc.work.map((row, index) => (
                <Text key={index} style={styles.sheetValue}>
                  {[row.period.trim(), row.detail.trim()].filter(Boolean).join(" - ") || "—"}
                </Text>
              ))}
            </>
          ) : null}
          {doc.relatives.length > 0 ? (
            <Text style={styles.sheetHeading}>QARINDOSHLAR: {doc.relatives.length} ta</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>F.I.Sh.</Text>
          <TextInput
            value={doc.fullName}
            onChangeText={(value) => change({ ...doc, fullName: value })}
            placeholder="Abdusattorov Pahlavon Abdurashid o‘g‘li"
            placeholderTextColor={colors.inkSoft}
            style={styles.input}
            maxLength={160}
          />

          {pairs.map((row) => (
            <View key={row.map((entry) => entry.id).join("-")} style={row.length === 2 ? styles.pair : undefined}>
              {row.map((entry) => (
                <View key={entry.id} style={row.length === 2 ? styles.pairItem : undefined}>
                  <Text style={styles.label}>{entry.label}</Text>
                  <TextInput
                    ref={(node) => { inputs.current[entry.id] = node; }}
                    value={doc.fields[entry.id] ?? ""}
                    onChangeText={(value) => field(entry.id, value)}
                    placeholder={entry.hint ?? ""}
                    placeholderTextColor={colors.inkSoft}
                    style={styles.input}
                    maxLength={300}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>

        <Section
          title="Mehnat faoliyati"
          hint="Har bir ish joyi alohida qator."
          onAdd={() => change({ ...doc, work: [...doc.work, { ...EMPTY_WORK }] })}
        >
          {doc.work.map((row, index) => (
            <View key={index} style={styles.rowCard}>
              <View style={styles.rowHead}>
                <Text style={styles.rowNumber}>{index + 1}</Text>
                <Pressable
                  accessibilityLabel="Qatorni o‘chirish"
                  onPress={() => change({ ...doc, work: doc.work.filter((_, at) => at !== index) })}
                  style={styles.rowDelete}
                >
                  <Trash2 color={colors.danger} size={15} strokeWidth={2} />
                </Pressable>
              </View>
              <TextInput
                value={row.period}
                onChangeText={(value) => change({ ...doc, work: doc.work.map((entry, at) => at === index ? { ...entry, period: value } : entry) })}
                placeholder="2022-2024 yy."
                placeholderTextColor={colors.inkSoft}
                style={styles.input}
              />
              <TextInput
                value={row.detail}
                onChangeText={(value) => change({ ...doc, work: doc.work.map((entry, at) => at === index ? { ...entry, detail: value } : entry) })}
                placeholder="Ish joyi va lavozimi"
                placeholderTextColor={colors.inkSoft}
                style={styles.input}
                multiline
              />
            </View>
          ))}
        </Section>

        <Section
          title="Yaqin qarindoshlar"
          hint="Hujjatning ikkinchi sahifasidagi jadval."
          onAdd={() => change({ ...doc, relatives: [...doc.relatives, { ...EMPTY_RELATIVE }] })}
        >
          {doc.relatives.map((row, index) => (
            <View key={index} style={styles.rowCard}>
              <View style={styles.rowHead}>
                <Text style={styles.rowNumber}>{index + 1}</Text>
                <Pressable
                  accessibilityLabel="Qatorni o‘chirish"
                  onPress={() => change({ ...doc, relatives: doc.relatives.filter((_, at) => at !== index) })}
                  style={styles.rowDelete}
                >
                  <Trash2 color={colors.danger} size={15} strokeWidth={2} />
                </Pressable>
              </View>
              {(["relation", "name", "born", "work", "address"] as const).map((key, column) => (
                <TextInput
                  key={key}
                  value={row[key]}
                  onChangeText={(value) => change({
                    ...doc,
                    relatives: doc.relatives.map((entry, at) => at === index ? { ...entry, [key]: value } : entry),
                  })}
                  placeholder={RELATIVE_COLUMNS[column]}
                  placeholderTextColor={colors.inkSoft}
                  style={styles.input}
                />
              ))}
            </View>
          ))}
        </Section>

        <View style={styles.photoNote}>
          <UserIcon color={colors.inkSoft} size={18} strokeWidth={1.8} />
          <Text style={styles.photoText}>
            Rasm 3×4 bo‘limida yaratgan suratdan olinadi. Hali yaratmagan bo‘lsangiz, hujjat rasmsiz chiqadi.
          </Text>
        </View>

        <View style={styles.downloads}>
          {(["docx", "pdf"] as const).map((format) => (
            <Pressable
              key={format}
              disabled={busy !== null}
              onPress={() => void download(format)}
              style={[styles.download, busy !== null && styles.disabled]}
            >
              {busy === format
                ? <ActivityIndicator color={colors.onPrimary} size="small" />
                : <><Download color={colors.onPrimary} size={icon.sm} strokeWidth={2} /><Text style={styles.downloadText}>{format.toUpperCase()}</Text></>}
            </Pressable>
          ))}
        </View>

        {saved ? (
          <View style={styles.savedRow}>
            <Check color={colors.success} size={15} strokeWidth={2.6} />
            <Text style={styles.savedText}>Saqlandi</Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, hint, onAdd, children }: {
  title: string;
  hint: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionHint}>{hint}</Text>
        </View>
        <Pressable accessibilityLabel="Qator qo‘shish" onPress={onAdd} style={styles.add}>
          <Plus color={colors.primary} size={18} strokeWidth={2.4} />
        </Pressable>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  sheet: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  // Serif and centred, because that is what the paper looks like.
  sheetTitle: { fontFamily: "Manrope_700Bold", fontSize: 15, textAlign: "center", color: colors.ink, letterSpacing: 0.5 },
  sheetName: { fontFamily: "Manrope_700Bold", fontSize: 14, textAlign: "center", color: colors.ink },
  sheetRule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  sheetRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: 3 },
  sheetLabel: { ...typography.caption, fontWeight: "700", color: colors.ink, flexShrink: 0, maxWidth: "48%" },
  sheetValue: { ...typography.caption, flex: 1, color: colors.ink },
  sheetEmpty: { color: colors.inkSoft },
  sheetHeading: { ...typography.caption, fontWeight: "700", textAlign: "center", color: colors.ink, marginTop: spacing.sm },
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 2, ...shadow },
  label: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.sm, marginBottom: 5 },
  input: { ...typography.body, color: colors.ink, minHeight: 46, paddingHorizontal: spacing.md, paddingTop: Platform.OS === "ios" ? 12 : 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  pair: { flexDirection: "row", gap: spacing.md },
  pairItem: { flex: 1 },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sectionCopy: { flex: 1 },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionHint: { ...typography.caption, color: colors.inkSoft },
  add: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  rowCard: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: spacing.sm },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowNumber: { ...typography.caption, fontWeight: "700", color: colors.inkMuted },
  rowDelete: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  photoNote: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  photoText: { ...typography.caption, flex: 1, color: colors.inkMuted },
  downloads: { flexDirection: "row", gap: spacing.sm },
  download: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 52, borderRadius: radius.lg, backgroundColor: colors.primary },
  downloadText: { ...typography.body, fontWeight: "700", color: colors.onPrimary },
  savedRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  savedText: { ...typography.caption, color: colors.success },
  disabled: { opacity: 0.5 },
  error: { ...typography.caption, color: colors.danger },
});
