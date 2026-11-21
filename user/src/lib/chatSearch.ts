import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

import { peerName, searchPeople, type ChatKind, type ChatListItem } from "@/lib/chat";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * The chat tab's one search box, and it is global.
 *
 * Three answers, in this order: the person's own conversations whose name
 * matches (found on the phone, which already holds them, so they show as the
 * first letter is typed); then people anywhere in the app by name or @handle
 * (`chat_search_people`: the new-chat search's rules, and never someone who
 * blocked the caller); then messages in the person's own conversations that
 * contain the words (`chat_search_messages`: only what they can still see
 * there). The server is asked once typing pauses, and a newer query cancels
 * the request still running for an older one.
 */

/** The same client, untyped: for the functions newer than the generated types. */
const loose = supabase as unknown as SupabaseClient;

/** The server refuses fewer letters than this, so it is not asked. */
export const SEARCH_MIN_LETTERS = 2;
/** Typing pauses this long before the server is asked: one request per pause, not per letter. */
const PAUSE_MS = 250;
const PEOPLE_LIMIT = 15;
const MESSAGE_LIMIT = 30;

export type FoundPerson = { id: string; full_name: string; username: string; avatar_url: string | null };

export type FoundMessage = {
  id: string;
  conversation_id: string;
  /** The other member of that conversation; null when the server did not say (an older server). */
  peer_id: string | null;
  sender_id: string | null;
  kind: ChatKind;
  /** The text, or the stretch of it around the words when they are deep in a long message. */
  body: string;
  created_at: string;
};

/** The query as it is sent: trimmed; null while too short to send. */
function serverQuery(query: string): string | null {
  const trimmed = query.trim();
  return trimmed.replace(/^@+/, "").trim().length >= SEARCH_MIN_LETTERS ? trimmed : null;
}

/** The query as the phone compares names: trimmed, lower case, without a leading "@". */
function localTerm(query: string): string {
  return query.trim().toLowerCase().replace(/^@+/, "").trim();
}

/** Conversations whose name, saved name or handle contains the words; in the list's own order. */
export function matchChats(chats: readonly ChatListItem[], query: string): ChatListItem[] {
  const term = localTerm(query);
  if (!term) return [...chats];
  const handleOnly = query.trim().startsWith("@");
  return chats.filter((chat) => {
    const handle = (chat.peer.username ?? "").toLowerCase();
    if (handleOnly) return handle.includes(term);
    // The saved name is what the row shows; their own name is still how one thinks of them.
    return `${peerName(chat.peer)} ${chat.peer.full_name} ${handle}`.toLowerCase().includes(term);
  });
}

/** A server that does not have the function yet: the migration has not reached it. */
function isMissingFunction(error: PostgrestError): boolean {
  return error.code === "PGRST202" || error.code === "42883";
}

/** `%`, `_` and `\` typed into the box mean themselves in a LIKE pattern. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** People anywhere in the app by name or handle, never the caller and never anyone who blocked them. */
export async function findPeople(query: string, signal: AbortSignal): Promise<FoundPerson[]> {
  const asked = serverQuery(query);
  if (!asked) return [];
  const { data, error } = await loose.rpc("chat_search_people", { p_query: asked, p_limit: PEOPLE_LIMIT }).abortSignal(signal);
  if (!error) return (data ?? []) as FoundPerson[];
  if (!isMissingFunction(error)) throw error;
  // A server without chat search yet: handles only, by the new-chat search, as before.
  return searchPeople(asked);
}

/** Messages containing the words, in the caller's own conversations, newest first. */
export async function findMessages(query: string, signal: AbortSignal): Promise<FoundMessage[]> {
  const asked = serverQuery(query);
  if (!asked) return [];
  const { data, error } = await loose.rpc("chat_search_messages", { p_query: asked, p_limit: MESSAGE_LIMIT }).abortSignal(signal);
  if (!error) return (data ?? []) as FoundMessage[];
  if (!isMissingFunction(error)) throw error;
  // A server without chat search yet: the table itself, whose row-level security already shows only the
  // messages the caller can see (a member, after their clearing, not hidden). Quiet when that fails too:
  // finding messages is new, and its absence must not bring an error over people found the old way.
  const direct = await loose.from("chat_messages").select("id, conversation_id, sender_id, kind, body, created_at")
    .is("deleted_at", null).ilike("body", `%${likeLiteral(asked)}%`)
    .order("created_at", { ascending: false }).limit(MESSAGE_LIMIT).abortSignal(signal);
  if (direct.error) return [];
  return ((direct.data ?? []) as Omit<FoundMessage, "peer_id">[]).map((row) => ({ ...row, peer_id: null }));
}

/**
 * A message as one line in the results: spaces folded, and started a little
 * before the words when they come late, so the match is what is seen.
 */
export function excerpt(body: string, query: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const term = localTerm(query);
  const lower = flat.toLowerCase();
  // Lower case that changes the length (a few letters do) would put the cut in the wrong place.
  if (!term || lower.length !== flat.length) return flat;
  const at = lower.indexOf(term);
  if (at <= 24) return flat;
  const space = flat.lastIndexOf(" ", at - 1);
  const start = space > at - 24 ? space + 1 : at - 16;
  return `…${flat.slice(start)}`;
}

/** The text cut around its first match, for drawing the match in another weight; null when it is not there. */
export function splitMatch(text: string, query: string): [string, string, string] | null {
  const term = localTerm(query);
  const lower = text.toLowerCase();
  if (!term || lower.length !== text.length) return null;
  const at = lower.indexOf(term);
  if (at < 0) return null;
  return [text.slice(0, at), text.slice(at, at + term.length), text.slice(at + term.length)];
}

/** One empty list for "not loaded yet", so what is worked out from it is not worked out again each time. */
const NO_CHATS: readonly ChatListItem[] = [];

type Answer = { query: string; round: number; people: FoundPerson[]; messages: FoundMessage[]; error: string | null };

export type ChatSearch = {
  /** Something is typed: the tab shows results instead of the list. */
  active: boolean;
  /** Enough is typed for the server to be asked. */
  asks: boolean;
  /** The server is being asked, or about to be. */
  searching: boolean;
  /** One's own conversations that match, plus those with anyone the server found. */
  chats: ChatListItem[];
  /** People found who have no conversation with the caller yet. */
  people: FoundPerson[];
  messages: FoundMessage[];
  /** Why the last search for exactly this query failed. */
  error: string | null;
  retry: () => void;
};

/**
 * The search as the tab shows it. While a newer query is on its way, the
 * answer to the one it grew from (or was cut back from) stays up rather than
 * blinking out; an answer to an unrelated query does not.
 */
export function useChatSearch(query: string, chats: readonly ChatListItem[] | null): ChatSearch {
  const asked = serverQuery(query);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!asked) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.allSettled([findPeople(asked, controller.signal), findMessages(asked, controller.signal)])
        .then(([people, messages]) => {
          // A newer query took over: what this one found is no longer what was asked.
          if (controller.signal.aborted) return;
          const failure = people.status === "rejected" ? people.reason : messages.status === "rejected" ? messages.reason : null;
          setAnswer({
            query: asked,
            round,
            people: people.status === "fulfilled" ? people.value : [],
            messages: messages.status === "fulfilled" ? messages.value : [],
            error: failure ? asErrorMessage(failure) : null,
          });
        });
    }, PAUSE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [asked, round]);

  const fresh = Boolean(asked && answer && answer.query === asked && answer.round === round);
  const related = Boolean(asked && answer
    && (asked.toLowerCase().startsWith(answer.query.toLowerCase()) || answer.query.toLowerCase().startsWith(asked.toLowerCase())));
  const shown = fresh || related ? answer : null;

  const all = chats ?? NO_CHATS;
  const matched = useMemo(() => matchChats(all, query), [all, query]);
  const found = shown?.people ?? null;
  const { withChats, people } = useMemo(() => {
    // Someone found who already has a conversation with the caller shows as that conversation.
    const chatOf = new Map(all.map((chat) => [chat.peer.id, chat]));
    const known = new Set((found ?? []).filter((person) => chatOf.has(person.id)).map((person) => person.id));
    return {
      withChats: all.filter((chat) => known.has(chat.peer.id)),
      people: (found ?? []).filter((person) => !chatOf.has(person.id)),
    };
  }, [all, found]);
  const shownChats = useMemo(() => {
    const ids = new Set(matched.map((chat) => chat.id));
    return [...matched, ...withChats.filter((chat) => !ids.has(chat.id))];
  }, [matched, withChats]);

  return {
    active: query.trim().length > 0,
    asks: Boolean(asked),
    searching: Boolean(asked) && !fresh,
    chats: shownChats,
    people: asked ? people : [],
    messages: asked ? shown?.messages ?? [] : [],
    error: fresh ? answer?.error ?? null : null,
    retry: () => setRound((value) => value + 1),
  };
}
