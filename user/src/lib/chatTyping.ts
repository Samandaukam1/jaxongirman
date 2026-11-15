import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";

/**
 * "Typing…": a Realtime broadcast between open screens, never stored.
 *
 * One channel per conversation, shared by everything on this phone that wants
 * it — the conversation itself and its row in the list — and closed when the
 * last of them lets go. Two subscriptions to one topic would otherwise fight
 * over it, and the first to close would silence the other.
 */

/** How long "typing…" stays up after the last signal. */
export const TYPING_MS = 5_000;
/** At most one signal this often, however fast one types. */
const SEND_EVERY_MS = 2_500;

type Entry = { channel: RealtimeChannel; listeners: Set<(user: string) => void>; count: number; sent: number };
const hub = new Map<string, Entry>();

function join(conversationId: string, listener: (user: string) => void): () => void {
  let entry = hub.get(conversationId);
  if (!entry) {
    const listeners = new Set<(user: string) => void>();
    const channel = supabase.channel(`typing-${conversationId}`, { config: { broadcast: { self: false, ack: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const from = (payload as { user?: string } | null)?.user;
        if (from) for (const each of listeners) each(from);
      })
      .subscribe();
    entry = { channel, listeners, count: 0, sent: 0 };
    hub.set(conversationId, entry);
  }
  entry.listeners.add(listener);
  entry.count += 1;
  const held = entry;
  return () => {
    held.listeners.delete(listener);
    held.count -= 1;
    if (held.count <= 0) {
      hub.delete(conversationId);
      void supabase.removeChannel(held.channel);
    }
  };
}

/** Tells the other side of a conversation this phone is typing. */
export function sendTyping(conversationId: string, me: string): void {
  const entry = hub.get(conversationId);
  if (!entry) return;
  const now = Date.now();
  if (now - entry.sent < SEND_EVERY_MS) return;
  entry.sent = now;
  void entry.channel.send({ type: "broadcast", event: "typing", payload: { user: me } });
}

/**
 * Which of these conversations someone else is typing in right now. Each
 * signal holds for TYPING_MS; a new one renews it.
 */
export function useTyping(conversationIds: readonly string[], me: string | null): ReadonlySet<string> {
  const [typing, setTyping] = useState<ReadonlySet<string>>(new Set());
  const key = useMemo(() => [...conversationIds].sort().join(","), [conversationIds]);
  useEffect(() => {
    if (!me || !key) return;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const leaves = key.split(",").map((id) => join(id, (from) => {
      if (from === me) return;
      setTyping((current) => (current.has(id) ? current : new Set(current).add(id)));
      clearTimeout(timers.get(id));
      timers.set(id, setTimeout(() => {
        setTyping((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, TYPING_MS));
    }));
    return () => {
      for (const leave of leaves) leave();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, [key, me]);
  return typing;
}
