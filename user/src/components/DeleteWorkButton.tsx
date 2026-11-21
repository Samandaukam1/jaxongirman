import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Trash2 } from "lucide-react-native";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, type AccessibilityActionEvent } from "react-native";

import { SendGlyph } from "@/components/SendGlyph";
import { asFunctionErrorMessage } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { isWeb } from "@/lib/web";
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
export function DeleteWorkButton({ kind, id, title, onDeleted, deletion }: {
  kind: WorkKind;
  id: string;
  title: string;
  onDeleted: () => void;
  /** The row's own deletion, shared with its screen-reader action: one question and one busy flag for both. */
  deletion?: Deletion;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["deck", "common"]);
  const own = useDeleteWork(kind, id, title, onDeleted);
  const { ask, busy } = deletion ?? own;

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

export type Deletion = { ask: () => void; busy: boolean };

/**
 * Asking before deleting one row, whether from its bin or from its
 * screen-reader action: the same question, the same red button.
 *
 * One deletion at a time: a second ask while the first is still on its way
 * (the bin again, the action as well) does nothing, rather than asking again
 * and reporting the second, already-deleted attempt as a failure. In a browser
 * the question is the browser's own — react-native-web's `Alert` draws
 * nothing, so there a bin used to be a button that did not answer.
 */
export function useDeleteWork(kind: WorkKind, id: string, title: string, onDeleted: () => void): Deletion {
  const { t } = useTranslation(["deck", "common"]);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  function remove() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void deleteWork(kind, id)
      .then(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onDeleted();
      })
      .catch(async (failure: unknown) => {
        const message = await asFunctionErrorMessage(failure);
        if (isWeb) window.alert(`${t("delete.failed")}\n\n${message}`);
        else Alert.alert(t("delete.failed"), message);
      })
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  }

  function ask() {
    if (running.current) return;
    const question = t(`delete.ask.${kind}`);
    const body = t("delete.body", {
      title,
      also: (TAKES_MORE as readonly string[]).includes(kind) ? t(`delete.also.${kind as (typeof TAKES_MORE)[number]}`) : "",
    });
    if (isWeb) {
      if (window.confirm(`${question}\n\n${body}`)) remove();
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(question, body, [
      { text: t("common:cancel"), style: "cancel" },
      { text: t("common:delete"), style: "destructive", onPress: remove },
    ]);
  }

  return { ask, busy };
}

/** The kinds a chat can carry. */
export const SENDABLE = ["presentation", "game", "academic"] as const;

/**
 * The paper plane at the end of a finished deck's, game's or scientific
 * work's row: sends that one thing to someone in the chat, in one tap. Sending
 * or deleting several is a long press on a row, which starts choosing them
 * (see `useWorkSelection`).
 */
export function SendWorkButton({ kind, id, title }: { kind: (typeof SENDABLE)[number]; id: string; title: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation("chat");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("m.sendToChat")}
      hitSlop={8}
      onPress={() => { haptic.light(); router.push({ pathname: "/(app)/chat/share", params: { kind, id, title } }); }}
      style={({ pressed }) => [styles.send, pressed && styles.sendPressed]}
    >
      <SendGlyph size={19} color={colors.primary} fold={colors.primarySoft} />
    </Pressable>
  );
}

/**
 * What a work row ends in. A finished deck, game or scientific work: the paper
 * plane, and deleting it goes through choosing it (a long press, then the bin
 * in the bar at the top) — plus a bin beside the plane in a browser, where a
 * long press is nothing anyone would think to try with a mouse. Anything else:
 * the bin. While a deletion runs: a spinner, so the row says something is
 * happening. While rows are being chosen the row shows its check instead.
 */
export function WorkRowEnd({ kind, id, title, sendable, onDeleted, deletion }: {
  kind: WorkKind;
  id: string;
  title: string;
  sendable: boolean;
  onDeleted?: () => void;
  deletion: Deletion;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  if (deletion.busy) {
    return <ActivityIndicator size="small" color={colors.danger} style={styles.spinner} />;
  }
  const bin = onDeleted ? <DeleteWorkButton kind={kind} id={id} title={title} onDeleted={onDeleted} deletion={deletion} /> : null;
  if (sendable && isSendable(kind)) {
    return (
      <>
        <SendWorkButton kind={kind} id={id} title={title} />
        {isWeb ? bin : null}
      </>
    );
  }
  return bin;
}

export const isSendable = (kind: WorkKind): kind is (typeof SENDABLE)[number] => (SENDABLE as readonly string[]).includes(kind);

/**
 * A work row as a screen reader meets it.
 *
 * The plane and the bin sit inside the row's own button, and VoiceOver reads
 * that as one element it cannot get into — so what they do is offered as the
 * row's actions instead, beside "select", which is what a long press does for
 * someone who can see the row. While rows are being chosen the row is a
 * checkbox and a tap is all it does, so it offers nothing else then.
 */
export function useWorkRowAccessibility({ kind, id, title, sendable, onDeleted, deletion, selecting, onSelect }: {
  kind: WorkKind;
  id: string;
  title: string;
  sendable: boolean;
  onDeleted?: () => void;
  deletion: Deletion;
  /** Several rows are being chosen right now. */
  selecting: boolean;
  /** Starts choosing with this row, or flips it while choosing. */
  onSelect?: () => void;
}) {
  const router = useRouter();
  const { t } = useTranslation(["chat", "deck", "projects"]);
  const send = sendable && isSendable(kind);
  if (selecting) {
    return { accessibilityActions: [], onAccessibilityAction: undefined, accessibilityHint: undefined };
  }
  return {
    accessibilityActions: [
      ...(send ? [{ name: "send", label: t("chat:m.sendToChat") }] : []),
      ...(onDeleted ? [{ name: "delete", label: t("deck:delete.label", { title }) }] : []),
      ...(onSelect ? [{ name: "select", label: t("projects:select.action") }] : []),
    ],
    onAccessibilityAction: ({ nativeEvent }: AccessibilityActionEvent) => {
      if (nativeEvent.actionName === "send" && send) router.push({ pathname: "/(app)/chat/share", params: { kind, id, title } });
      else if (nativeEvent.actionName === "delete") deletion.ask();
      else if (nativeEvent.actionName === "select") onSelect?.();
    },
    // A long press is invisible until someone says it is there.
    accessibilityHint: !isWeb && onSelect ? t("projects:select.hint") : undefined,
  };
}

const useStyles = makeStyles((colors) => ({
  spinner: { width: 36, height: 36 },
  button: {
    width: 36, height: 36, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  pressed: { backgroundColor: colors.dangerSoft },
  send: {
    width: 36, height: 36, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  sendPressed: { opacity: 0.75, transform: [{ scale: 0.94 }] },
}));
