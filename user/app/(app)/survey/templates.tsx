import { SURVEY_QUESTION_LABELS, type SurveyQuestionType } from "@jaxongirman/types";
import { useFocusEffect, useRouter } from "expo-router";
import { BookmarkCheck, Copy, FilePlus2, Pencil, Trash2 } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, InlineError, SkeletonCard } from "@/components/StateBlocks";
import { formatShortDateTime } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { colors, icon, radius, spacing, typography } from "@/theme/tokens";

type TemplateQuestion = { id: string; label: string; type: SurveyQuestionType; position: number };
type Template = {
  id: string;
  name: string;
  description: string;
  use_count: number;
  updated_at: string;
  questions: TemplateQuestion[];
};

/**
 * Saved question sets.
 *
 * This is the half of the module that is meant to last. Respondents' answers
 * expire on a timer; the questions a creator spent time writing do not, and
 * this screen is where they are renamed, reused and thrown away on purpose.
 */
export default function SurveyTemplatesScreen() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Template | null>(null);
  const [draftName, setDraftName] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const { data, error: requestError } = await supabase
      .from("survey_templates")
      .select("id,name,description,use_count,updated_at,survey_template_questions(id,label,type,position)")
      .order("updated_at", { ascending: false });
    if (requestError) {
      setError(asErrorMessage(requestError));
    } else {
      setTemplates((data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        use_count: row.use_count,
        updated_at: row.updated_at,
        questions: [...(row.survey_template_questions ?? [])].sort((left, right) => left.position - right.position),
      })));
      setError(null);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Not named use* — a plain handler that ESLint would otherwise read as a hook.
  async function startFromTemplate(template: Template) {
    setBusy(template.id);
    const { data, error: createError } = await supabase.rpc("create_survey_from_template", {
      p_template_id: template.id,
      p_title: template.name,
    });
    setBusy(null);
    if (createError) { setError(asErrorMessage(createError)); return; }
    router.push({ pathname: "/(app)/survey/create", params: { id: data as string } });
  }

  function duplicate(template: Template) {
    router.push({ pathname: "/(app)/survey/create", params: { templateId: template.id } });
  }

  async function rename() {
    if (!renaming || draftName.trim() === "") return;
    setBusy(renaming.id);
    const { error: renameError } = await supabase
      .from("survey_templates")
      .update({ name: draftName.trim() })
      .eq("id", renaming.id);
    setBusy(null);
    if (renameError) setError(asErrorMessage(renameError));
    else { setRenaming(null); void load(true); }
  }

  function remove(template: Template) {
    Alert.alert("Shablon o‘chirilsinmi?", `“${template.name}” butunlay o‘chiriladi.`, [
      { text: "Bekor qilish", style: "cancel" },
      {
        text: "O‘chirish",
        style: "destructive",
        onPress: async () => {
          const { error: deleteError } = await supabase.from("survey_templates").delete().eq("id", template.id);
          if (deleteError) setError(asErrorMessage(deleteError));
          else void load(true);
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Savol shablonlari" subtitle="Qayta ishlatiladigan savollar to‘plami" />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        <View style={styles.note}>
          <BookmarkCheck color={colors.primary} size={16} strokeWidth={2} />
          <Text style={styles.noteText}>
            Shablonlar faqat savollarni saqlaydi. Javob beruvchilarning javoblari shablonlarga hech qachon yozilmaydi.
          </Text>
        </View>

        {loading ? <><SkeletonCard /><SkeletonCard /></> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {!loading && !error && templates.length === 0 ? (
          <EmptyState
            icon={FilePlus2}
            title="Shablon yo‘q"
            message="So‘rovnoma yaratishda “Savollarni shablon sifatida saqlash” tugmasini bossangiz, savollaringiz shu yerda to‘planadi."
          />
        ) : null}

        <View style={styles.list}>
          {templates.map((template) => (
            <View key={template.id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardCopy}>
                  <Text numberOfLines={1} style={styles.cardTitle}>{template.name}</Text>
                  <Text style={styles.cardMeta}>
                    {template.questions.length} savol · {template.use_count} marta ishlatilgan · {formatShortDateTime(template.updated_at)}
                  </Text>
                </View>
                <Pressable accessibilityLabel="Nomini o‘zgartirish" onPress={() => { setRenaming(template); setDraftName(template.name); }} style={styles.iconButton}>
                  <Pencil color={colors.ink} size={15} strokeWidth={2} />
                </Pressable>
                <Pressable accessibilityLabel="O‘chirish" onPress={() => remove(template)} style={[styles.iconButton, styles.iconDanger]}>
                  <Trash2 color={colors.danger} size={15} strokeWidth={2} />
                </Pressable>
              </View>

              <View style={styles.questionList}>
                {template.questions.slice(0, 5).map((question) => (
                  <View key={question.id} style={styles.questionRow}>
                    <View style={styles.dot} />
                    <Text numberOfLines={1} style={styles.questionLabel}>{question.label}</Text>
                    <Text style={styles.questionType}>{SURVEY_QUESTION_LABELS[question.type]}</Text>
                  </View>
                ))}
                {template.questions.length > 5 ? (
                  <Text style={styles.more}>+{template.questions.length - 5} ta savol</Text>
                ) : null}
              </View>

              <View style={styles.cardActions}>
                <Pressable accessibilityRole="button" onPress={() => duplicate(template)} style={styles.secondaryAction}>
                  <Copy color={colors.primary} size={icon.xs} strokeWidth={2.2} />
                  <Text style={styles.secondaryText}>Nusxadan tuzish</Text>
                </Pressable>
                <PrimaryButton
                  label="So‘rovnoma yaratish"
                  loading={busy === template.id}
                  onPress={() => void startFromTemplate(template)}
                  style={styles.primaryAction}
                />
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Yopish" onPress={() => setRenaming(null)} style={styles.backdrop}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Shablon nomi</Text>
            <TextInput
              value={draftName}
              onChangeText={(value) => setDraftName(value.slice(0, 120))}
              placeholder="Yangi nom"
              placeholderTextColor={colors.inkSoft}
              autoFocus
              style={styles.input}
            />
            {error ? <InlineError message={error} /> : null}
            <PrimaryButton label="Saqlash" loading={busy === renaming?.id} disabled={draftName.trim() === ""} onPress={() => void rename()} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },

  note: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  noteText: { ...typography.caption, color: colors.primaryDeep, flex: 1, lineHeight: 18 },

  list: { gap: spacing.md },
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  cardCopy: { flex: 1, gap: 2 },
  cardTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 16 },
  cardMeta: { ...typography.caption, color: colors.inkSoft },
  iconButton: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  iconDanger: { backgroundColor: colors.dangerSoft },

  questionList: { gap: 6 },
  questionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
  questionLabel: { ...typography.caption, color: colors.inkMuted, flex: 1 },
  questionType: { ...typography.caption, fontSize: 10, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  more: { ...typography.caption, fontSize: 11, color: colors.inkSoft, marginLeft: 13 },

  cardActions: { gap: spacing.sm },
  secondaryAction: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.sm },
  secondaryText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  primaryAction: { minHeight: 48 },

  backdrop: { flex: 1, backgroundColor: "rgba(21,14,36,.45)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  sheet: { alignSelf: "stretch", gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
  sheetTitle: { ...typography.heading, color: colors.ink },
  input: {
    ...typography.body, color: colors.ink, minHeight: 52,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
});
