import type { Tables } from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Download, Eye, EyeOff, MessageCircle, PenLine, Play } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { CrosswordClueList, CrosswordGrid, useCrosswordSolver } from "@/components/Crossword";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { loadCrossword, openCrosswordPdf } from "@/lib/crossword";
import { asErrorMessage } from "@/lib/format";
import { createSession } from "@/lib/games";
import { supabase } from "@/lib/supabase";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Game = Tables<"games">;
type Loaded = NonNullable<Awaited<ReturnType<typeof loadCrossword>>>;

const NO_LETTERS: Record<string, string> = {};
const ignore = () => undefined;

/**
 * A crossword's own page: the grid, its clues, and the three things to do
 * with it — solve it here, print it, or put it on a board for a room.
 */
export function CrosswordOverview({ game }: { game: Game }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["games", "common"]);
  const { t: tChat } = useTranslation("chat");
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "host" | "pdf">(null);
  const [reveal, setReveal] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const next = await loadCrossword(game.id);
      if (!next) throw new Error(t("editor.notFound"));
      setLoaded(next);
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [game.id, t]);

  useEffect(() => { void load(); }, [load]);

  async function host() {
    setBusy("host");
    setActionError(null);
    try {
      const session = await createSession(game.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push(`/oyingoh/host/${session.session_id}`);
    } catch (failure) {
      setActionError(asErrorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function pdf() {
    setBusy("pdf");
    setActionError(null);
    try {
      await openCrosswordPdf(game.id, game.title);
    } catch (failure) {
      setActionError(asErrorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function rename(title: string) {
    if (!title || title === game.title) return;
    const { error: saveError } = await supabase.from("games").update({ title }).eq("id", game.id);
    if (saveError) setActionError(asErrorMessage(saveError));
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("crossword.badge")} subtitle={game.title} onLeave={() => router.back()} />
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !loaded ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <Preview
          loaded={loaded}
          game={game}
          reveal={reveal}
          onReveal={() => setReveal((value) => !value)}
          onRename={(title) => void rename(title)}
        >
          {actionError ? <InlineError message={actionError} /> : null}
          <PrimaryButton label={t("crossword.solve")} icon={PenLine} disabled={busy !== null} onPress={() => router.push(`/oyingoh/crossword/${game.id}`)} />
          <View style={styles.action}>
            <PrimaryButton label={t("crossword.host")} icon={Play} tone="secondary" loading={busy === "host"} disabled={busy !== null} onPress={() => void host()} />
            <Text style={styles.hint}>{t("crossword.hostHint")}</Text>
          </View>
          <View style={styles.action}>
            <PrimaryButton label={t("crossword.pdf")} icon={Download} tone="secondary" loading={busy === "pdf"} disabled={busy !== null} onPress={() => void pdf()} />
            <Text style={styles.hint}>{t("crossword.pdfHint")}</Text>
          </View>
          <PrimaryButton
            label={tChat("sendToChat")}
            icon={MessageCircle}
            tone="ghost"
            disabled={busy !== null}
            onPress={() => router.push({ pathname: "/(app)/chat/share", params: { kind: "game", id: game.id, title: game.title } })}
          />
        </Preview>
      )}
    </View>
  );
}

function Preview({ loaded, game, reveal, onReveal, onRename, children }: {
  loaded: Loaded; game: Game; reveal: boolean; onReveal: () => void; onRename: (title: string) => void; children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("games");
  const solver = useCrosswordSolver(loaded.crossword, NO_LETTERS, ignore, true);
  const Toggle = reveal ? EyeOff : Eye;
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <TextInput
        style={styles.title}
        defaultValue={game.title}
        maxLength={160}
        placeholder={t("editor.name")}
        placeholderTextColor={colors.inkSoft}
        onEndEditing={(event) => onRename(event.nativeEvent.text.trim())}
      />
      <Text style={styles.meta}>
        {t("crossword.meta", { words: loaded.crossword.words.length, minutes: Math.round(loaded.seconds / 60) })}
      </Text>
      <CrosswordGrid solver={solver} letters={NO_LETTERS} reveal={reveal} quiet />
      <Pressable accessibilityRole="button" onPress={onReveal} style={styles.revealToggle}>
        <Toggle color={colors.primary} size={icon.sm} />
        <Text style={styles.revealText}>{reveal ? t("crossword.hideAnswers") : t("crossword.showAnswers")}</Text>
      </Pressable>
      {children}
      <CrosswordClueList solver={solver} showAnswers={reveal} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  title: { ...typography.title, color: colors.ink, paddingVertical: 0 },
  meta: { ...typography.caption, color: colors.inkMuted, marginTop: -spacing.sm },
  revealToggle: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  revealText: { ...typography.caption, color: colors.primaryDeep, fontFamily: "JaxongirmanSans_700Bold" },
  action: { gap: spacing.xs },
  hint: { ...typography.caption, color: colors.inkMuted, paddingHorizontal: spacing.xs },
}));
