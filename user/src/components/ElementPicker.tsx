import { Search, Shapes, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import { searchElements, type ElementCandidate } from "@/lib/jelement";
import { colors, icon, radius, spacing, typography } from "@/theme/tokens";

/**
 * Choosing an object to put on a slide.
 *
 * A search rather than a catalogue, because a library meant to hold a hundred
 * families cannot be browsed on a phone — and because somebody adding a picture
 * to a slide about mining already knows the word they are looking for.
 *
 * What comes back is a shortlist with no geometry in it. The drawing is fetched
 * only once something is chosen, which is what keeps the sheet fast however
 * large the library grows.
 */
export function ElementPicker({
  visible,
  slideRole,
  onClose,
  onPick,
}: {
  visible: boolean;
  slideRole?: string;
  onClose: () => void;
  onPick: (candidate: ElementCandidate) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ElementCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!visible) { setQuery(""); setResults([]); setTouched(false); setError(null); }
  }, [visible]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) { setResults([]); return; }

    // Typed queries settle before a request goes out: a search per keystroke is
    // a request per keystroke, and the answer for a half-typed word is noise.
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      setTouched(true);
      void searchElements(needle, slideRole)
        .then((found) => { if (active) { setResults(found); setError(null); } })
        .catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "Qidiruv ishlamadi."); })
        .finally(() => { if (active) setSearching(false); });
    }, 350);

    return () => { active = false; clearTimeout(timer); };
  }, [query, slideRole]);

  const grouped = useMemo(() => {
    const families = new Map<string, ElementCandidate[]>();
    for (const candidate of results) {
      const list = families.get(candidate.family_name) ?? [];
      list.push(candidate);
      families.set(candidate.family_name, list);
    }
    return [...families];
  }, [results]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <Text style={styles.title}>Element qo‘shish</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Yopish" onPress={onClose} style={styles.close}>
            <X color={colors.ink} size={icon.md} strokeWidth={2} />
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Search color={colors.inkSoft} size={18} strokeWidth={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Ekskavator, dron, diagramma…"
            placeholderTextColor={colors.inkSoft}
            autoFocus
            autoCapitalize="none"
            style={styles.searchInput}
          />
          {searching ? <ActivityIndicator color={colors.primary} size="small" /> : null}
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {!touched && !error ? (
            <Text style={styles.hint}>
              Slaydga qo‘ymoqchi bo‘lgan narsani yozing. O‘zbekcha ham, inglizcha ham topadi.
            </Text>
          ) : null}

          {touched && !searching && results.length === 0 && !error ? (
            // Said plainly rather than left as an empty sheet: an element that
            // does not exist is a real answer, and the library is young.
            <Text style={styles.hint}>
              «{query.trim()}» bo‘yicha element topilmadi. Boshqa so‘z bilan urinib ko‘ring.
            </Text>
          ) : null}

          {grouped.map(([familyName, candidates]) => (
            <View key={familyName} style={styles.family}>
              <Text style={styles.familyName}>{familyName}</Text>
              <View style={styles.grid}>
                {candidates.map((candidate) => (
                  <Pressable
                    key={candidate.id}
                    accessibilityRole="button"
                    onPress={() => onPick(candidate)}
                    style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                  >
                    <View style={styles.cardIcon}>
                      <Shapes color={colors.primary} size={22} strokeWidth={1.9} />
                    </View>
                    <Text numberOfLines={2} style={styles.cardName}>
                      {candidate.display_name || candidate.canonical_name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.canvas },
  head: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { ...typography.heading, color: colors.ink },
  close: {
    width: 36, height: 36, borderRadius: 18, alignItems: "center",
    justifyContent: "center", backgroundColor: colors.surfaceMuted,
  },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    margin: spacing.lg, marginBottom: 0, paddingHorizontal: spacing.md,
    minHeight: 48, borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { ...typography.body, color: colors.ink, flex: 1, paddingVertical: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxxl },
  hint: { ...typography.body, color: colors.inkMuted, lineHeight: 22 },
  error: { ...typography.body, color: colors.danger },
  family: { gap: spacing.sm },
  familyName: { ...typography.caption, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: {
    width: 104, gap: spacing.xs, padding: spacing.sm, alignItems: "center",
    borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  cardPressed: { opacity: 0.8 },
  cardIcon: {
    width: 56, height: 56, borderRadius: radius.md, alignItems: "center",
    justifyContent: "center", backgroundColor: colors.primarySoft,
  },
  cardName: { ...typography.caption, color: colors.ink, textAlign: "center" },
});
