import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { listHostable } from "@/lib/games";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Hostable = { id: string; title: string; question_count: number; category_label: string | null; difficulty: string; source: string };

/** Where a hostable game came from; named in the `play` table under `host.source`. */
const SOURCES = ["mine", "presentation", "purchased", "free"] as const;
const isSource = (value: string): value is (typeof SOURCES)[number] => (SOURCES as readonly string[]).includes(value);

/**
 * "Qaysi o‘yinni o‘tkazasiz?" — every game this account may put in front of a
 * room, grouped by where it came from.
 *
 * Asked by the host remote of a projector claimed before a game was chosen,
 * and by the web app before it opens a match on the computer it runs on.
 */
export function HostablePicker({ busy, error, onPick }: {
  busy: boolean;
  /** The caller's own failure, shown above the list. */
  error?: string | null;
  onPick: (gameId: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["play", "games"]);
  const router = useRouter();
  const [hostable, setHostable] = useState<Hostable[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listHostable()
      .then((rows) => { if (alive) setHostable(rows); })
      .catch((failure) => { if (alive) { setLoadError(asErrorMessage(failure)); setHostable([]); } });
    return () => { alive = false; };
  }, []);

  const groups = Object.entries(
    (hostable ?? []).reduce<Record<string, Hostable[]>>((sorted, game) => {
      (sorted[game.source] ??= []).push(game);
      return sorted;
    }, {}),
  );

  return (
    <>
      <Text style={styles.pickerTitle}>{t("host.pick")}</Text>
      <Text style={styles.hint}>{t("host.pickHint")}</Text>
      {error || loadError ? <InlineError message={(error ?? loadError) as string} /> : null}
      {hostable === null ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : hostable.length === 0 && !loadError ? (
        <View style={styles.emptyPicker}>
          <Text style={styles.settingText}>{t("host.noGames")}</Text>
          <Text style={styles.hint}>{t("host.noGamesBody")}</Text>
          <PrimaryButton label={t("host.createGame")} onPress={() => router.replace("/(app)/oyingoh/create")} />
        </View>
      ) : (
        groups.map(([source, games]) => (
          <View key={source} style={{ gap: spacing.sm }}>
            <Text style={styles.groupLabel}>{isSource(source) ? t(`host.source.${source}`) : source}</Text>
            {games.map((game) => (
              <Pressable
                key={game.id}
                style={({ pressed }) => [styles.pickRow, pressed && styles.pickRowPressed, busy && styles.pickRowBusy]}
                disabled={busy}
                onPress={() => onPick(game.id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingText} numberOfLines={1}>{game.title || t("games:untitled")}</Text>
                  <Text style={styles.hint}>
                    {t("games:questions", { count: game.question_count })}
                    {game.category_label ? ` · ${game.category_label}` : ""}
                  </Text>
                </View>
                <ChevronRight color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
              </Pressable>
            ))}
          </View>
        ))
      )}
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  pickerTitle: { ...typography.title, color: colors.ink, fontSize: 22 },
  hint: { ...typography.caption, color: colors.inkMuted },
  groupLabel: { ...typography.caption, color: colors.accent, letterSpacing: 1.2, marginTop: spacing.sm },
  pickRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  pickRowPressed: { transform: [{ scale: 0.98 }], backgroundColor: colors.primarySoft },
  pickRowBusy: { opacity: 0.6 },
  emptyPicker: { gap: spacing.md, paddingVertical: spacing.xl },
  settingText: { ...typography.bodyMedium, color: colors.ink, flex: 1 },
}));
