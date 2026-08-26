import { Check, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";

import { Appear } from "@/components/Appear";
import { Touchable } from "@/components/Touchable";
import { isLoaded, loadFace } from "@/lib/fontCache";
import { faceFor, fontsByName, listFonts, type FontFamily } from "@/lib/fontLibrary";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Choosing a typeface, out of two thousand.
 *
 * The rule that shapes this: a font name written in the interface font tells
 * you nothing. So every row draws its own name in its own face — which means
 * every visible row is a download, which means the list can only ever fetch
 * what is on screen. Rows ask when they mount and never before.
 *
 * The sections are the shortcuts round the size of the shelf. "Oxirgi
 * ishlatilgan" is what a person actually reaches for; "Tavsiya etilgan" is what
 * an administrator marked; the rest is there for the once a month somebody
 * wants something else.
 */

export type PickedFont = { family: string; slug: string; faceName: string; weight: number; italic: boolean };

const PAGE = 30;

/** One row, which loads its own face and redraws when it lands. */
function FontRow({
  family, weight, italic, selected, onPick,
}: {
  family: FontFamily;
  weight: number;
  italic: boolean;
  selected: boolean;
  onPick: (picked: PickedFont) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const face = useMemo(() => faceFor(family, weight, italic), [family, italic, weight]);
  const [faceName, setFaceName] = useState<string | null>(
    face && isLoaded(family.slug, face.weight, face.italic) ? null : null,
  );

  useEffect(() => {
    if (!face) return;
    let alive = true;
    void loadFace(family.slug, face).then((name) => { if (alive) setFaceName(name); });
    return () => { alive = false; };
  }, [face, family.slug]);

  if (!face) return null;

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onPick({
        family: family.name, slug: family.slug,
        faceName: faceName ?? "", weight: face.weight, italic: face.italic,
      })}
      style={[styles.row, selected && styles.rowOn]}
    >
      <View style={styles.rowCopy}>
        {/* The name in its own face once it is there, and in the interface font
            until then — never a skeleton, because the name is still the answer
            to "which font is this" while the shapes are still arriving. */}
        <Text
          numberOfLines={1}
          style={[styles.sample, faceName ? { fontFamily: faceName } : null]}
        >
          {family.name}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {family.category}{family.variable ? " · variable" : ""} · {family.faces.length} ta ko‘rinish
        </Text>
      </View>
      {selected ? <Check color={colors.primary} size={icon.sm} strokeWidth={2.4} /> : null}
    </Touchable>
  );
}

export function FontPicker({
  visible, current, weight, italic, recent, onClose, onPick,
}: {
  visible: boolean;
  /** The slug in use, so the list can mark it. */
  current: string | null;
  weight: number;
  italic: boolean;
  recent: readonly string[];
  onClose: () => void;
  onPick: (picked: PickedFont) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  const [families, setFamilies] = useState<FontFamily[]>([]);
  const [recents, setRecents] = useState<FontFamily[]>([]);
  const [featured, setFeatured] = useState<FontFamily[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (offset: number, replace: boolean) => {
    setLoading(true);
    try {
      const rows = await listFonts({ search: query.trim() || undefined, limit: PAGE, offset });
      setFamilies((current_) => (replace ? rows : [...current_, ...rows]));
      setDone(rows.length < PAGE);
      setError(null);
    } catch {
      setError("Shriftlar ro‘yxati olinmadi.");
    }
    setLoading(false);
  }, [query]);

  useEffect(() => {
    if (!visible) return;
    void load(0, true);
  }, [load, visible]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void Promise.all([fontsByName(recent), listFonts({ featured: true, limit: 12 })])
      .then(([used, picks]) => { if (alive) { setRecents(used); setFeatured(picks); } })
      .catch(() => { /* the sections are shortcuts; the full list still works */ });
    return () => { alive = false; };
  }, [recent, visible]);

  const searching = query.trim().length > 0;
  const sections = useMemo(() => ([
    ...(searching || recents.length === 0 ? [] : [{ title: "Oxirgi ishlatilgan", rows: recents }]),
    ...(searching || featured.length === 0 ? [] : [{ title: "Tavsiya etilgan", rows: featured }]),
    { title: searching ? "Topilganlar" : "Barcha shriftlar", rows: families },
  ]), [families, featured, recents, searching]);

  const flat = useMemo(() => sections.flatMap((section) => (
    [{ heading: section.title } as const, ...section.rows.map((family) => ({ family }))]
  )), [sections]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Shrift</Text>
          <Pressable accessibilityLabel="Yopish" onPress={onClose} hitSlop={10} style={styles.close}>
            <X color={colors.ink} size={icon.md} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Search color={colors.inkSoft} size={17} strokeWidth={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Shrift nomi"
            placeholderTextColor={colors.inkSoft}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.searchInput}
          />
          {query ? (
            <Pressable accessibilityLabel="Tozalash" onPress={() => setQuery("")} hitSlop={8}>
              <X color={colors.inkSoft} size={15} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FlatList
          data={flat}
          keyExtractor={(entry, index) => ("heading" in entry ? `h-${entry.heading}-${index}` : entry.family.id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          // Only what is on screen asks for its face; the window is kept small
          // on purpose, because every mounted row is a font download.
          initialNumToRender={8}
          windowSize={5}
          removeClippedSubviews
          onEndReachedThreshold={0.6}
          onEndReached={() => { if (!loading && !done) void load(families.length, false); }}
          ListFooterComponent={loading ? <ActivityIndicator color={colors.primary} style={styles.footer} /> : null}
          renderItem={({ item, index }) => ("heading" in item ? (
            <Text style={styles.heading}>{item.heading}</Text>
          ) : (
            <Appear index={index}>
              <FontRow
                family={item.family}
                weight={weight}
                italic={italic}
                selected={item.family.slug === current}
                onPick={onPick}
              />
            </Appear>
          ))}
        />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  sheet: { flex: 1, backgroundColor: colors.canvas, paddingTop: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  title: { ...typography.title, flex: 1, color: colors.ink },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.xl, height: 46, paddingHorizontal: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceMuted,
  },
  searchInput: { ...typography.body, flex: 1, color: colors.ink, paddingVertical: 0 },
  error: { ...typography.caption, color: colors.danger, paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  list: { padding: spacing.xl, gap: spacing.sm },
  heading: { ...typography.caption, fontWeight: "700", color: colors.inkMuted, marginTop: spacing.md },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    minHeight: 62, paddingHorizontal: spacing.lg,
    borderRadius: radius.lg, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  rowCopy: { flex: 1, gap: 2, paddingVertical: spacing.sm },
  // 19pt: large enough that a typeface's character shows, small enough that a
  // display face with tall ascenders does not push the row out of shape.
  sample: { fontSize: 19, lineHeight: 25, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkSoft },
  footer: { paddingVertical: spacing.lg },
}));
