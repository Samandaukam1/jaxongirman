import * as Haptics from "expo-haptics";
import { Trash2 } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable } from "react-native";

import { asFunctionErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { radius } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

export type WorkKind = "presentation" | "portrait" | "objective" | "academic" | "game" | "survey";

/** The kinds whose deletion takes more with it — said before the person agrees rather than discovered after. */
const TAKES_MORE = ["presentation", "game", "survey"] as const;

/** Deletes one piece of work through `delete-work`, which checks ownership itself. */
export async function deleteWork(kind: WorkKind, id: string): Promise<void> {
  const { error } = await supabase.functions.invoke("delete-work", { body: { kind, id } });
  if (error) throw error;
}

/**
 * The bin at the end of a row.
 *
 * Its own pressable inside the row's, so a tap here never opens the thing
 * being deleted. One press asks; nothing is removed until the red button in
 * the question is pressed, because none of this can be brought back.
 */
export function DeleteWorkButton({ kind, id, title, onDeleted }: {
  kind: WorkKind;
  id: string;
  title: string;
  onDeleted: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["deck", "common"]);
  const [busy, setBusy] = useState(false);

  function ask() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      t(`delete.ask.${kind}`),
      t("delete.body", {
        title,
        also: (TAKES_MORE as readonly string[]).includes(kind) ? t(`delete.also.${kind as (typeof TAKES_MORE)[number]}`) : "",
      }),
      [
        { text: t("common:cancel"), style: "cancel" },
        {
          text: t("common:delete"),
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void deleteWork(kind, id)
              .then(() => {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                onDeleted();
              })
              .catch(async (failure: unknown) => Alert.alert(t("delete.failed"), await asFunctionErrorMessage(failure)))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("delete.label", { title })}
      hitSlop={8}
      disabled={busy}
      onPress={ask}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {busy
        ? <ActivityIndicator size="small" color={colors.danger} />
        : <Trash2 color={colors.inkSoft} size={17} strokeWidth={2} />}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  button: {
    width: 36, height: 36, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  pressed: { backgroundColor: colors.dangerSoft },
}));
