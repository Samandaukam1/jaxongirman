import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { Platform } from "react-native";

import { changesChannel, supabase } from "@/lib/supabase";
import { localFileUrl, streamLocalFile } from "@/lib/upload";
import type { NoteFile } from "@/lib/videoNote";

/**
 * Chat: one-to-one conversations (`chat_*` in the database).
 *
 * Messages are written only through `chat_send` (and `chat_forward`), read by
 * row-level security, and arrive on the other phone through Realtime on
 * `chat_messages`. Files go to `chat-media/<conversation>/<me>/<file>` first,
 * then the message names them. Every send carries a client id, so a send
 * repeated after a dropped connection is still one message.
 *
 * Replies, reactions, pins and deletions are all changes to the message row,
 * so the other phone hears of every one of them the same way it hears of an
 * edit.
 */

/** The same client, untyped: for the columns and functions newer than the generated types. */
const loose = supabase as unknown as SupabaseClient;

export type ChatPeer = {
  id: string;
  full_name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string;
  /** Organisation and field, as their own card shows them. */
  study?: string;
  decks?: number;
  games?: number;
  contact_name: string | null;
  muted: boolean;
  saved: boolean;
  /** I blocked them. Whether they blocked me is never said. */
  blocked?: boolean;
  /** Here now; false (and no last-seen time) between two people one of whom blocked the other. */
  online?: boolean;
  last_seen_at?: string | null;
};

export type ChatKind = "text" | "image" | "voice" | "video" | "share" | "album";
export type ChatShare = { kind: "presentation" | "game" | "academic"; id: string; title: string };
/** One picture of an album, or one part of a video message recorded in parts. */
export type ChatItem = { path: string; width?: number | null; height?: number | null; duration_ms?: number | null };

export type ChatListItem = {
  id: string;
  peer: ChatPeer;
  peer_read_at: string;
  last: {
    kind: ChatKind; body: string; sender_id: string | null; created_at: string; share_title: string | null;
    /** Pictures in an album. */
    count?: number;
    forwarded?: boolean;
  } | null;
  unread: number;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  kind: ChatKind;
  body: string;
  media_path: string | null;
  /** `waveform`: a voice message's shape, measured as it was recorded (bars 0–31; see voiceWave.ts). */
  media: { width?: number; height?: number; duration_ms?: number; mime?: string; waveform?: number[] };
  share: ChatShare | null;
  client_id: string | null;
  created_at: string;
  /** Set when the sender corrected it. */
  edited_at?: string | null;
  /** The message this one answers. */
  reply_to_id?: string | null;
  /** That message, as the server embeds it or as this phone found it. */
  reply?: ChatQuote | null;
  /** Passed on: whom it first came from. */
  forward_from_id?: string | null;
  forward_from_name?: string | null;
  /** Who reacted, and with what: one emoji each. */
  reactions?: Record<string, string>;
  pinned_at?: string | null;
  /** Taken back by its sender: the phones drop it. */
  deleted_at?: string | null;
  /** An album's pictures, in order. */
  items?: ChatItem[] | null;
  /** Only on this phone: sent but not yet confirmed, or failed. */
  pending?: "sending" | "failed";
  /** Only on this phone: the file being sent, shown before it is uploaded. */
  localUri?: string;
  /** Only on this phone: an album's pictures before they are uploaded. */
  localItems?: { uri: string; width: number; height: number }[];
  /** Only on this phone: a video message's parts, as recorded here (it plays them all, in order). */
  localParts?: string[];
};

/** What a reply shows of the message it answers. */
export type ChatQuote = Pick<ChatMessage, "id" | "sender_id" | "kind" | "body" | "media_path" | "share" | "deleted_at"> & {
  items?: ChatItem[] | null;
};

export const VOICE_MAX_MS = 120_000;
export const VIDEO_MAX_MS = 60_000;
/** Pictures in one album, and things sent at once. */
export const MAX_PICK = 10;
const PAGE = 40;
const MESSAGE_COLUMNS = "*, reply:reply_to_id(id, sender_id, kind, body, media_path, items, share, deleted_at)";

/** The name a person is shown under: the saved one, else theirs, else their handle. */
export function peerName(peer: Pick<ChatPeer, "contact_name" | "full_name" | "username">): string {
  return peer.contact_name?.trim() || peer.full_name?.trim() || (peer.username ? `@${peer.username}` : "—");
}

export function initialsOf(name: string): string {
  const parts = name.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export async function listChats(): Promise<ChatListItem[]> {
  const { data, error } = await supabase.rpc("chat_list");
  if (error) throw error;
  return (data as unknown as ChatListItem[]) ?? [];
}

export async function unreadTotal(): Promise<number> {
  const { data, error } = await supabase.rpc("chat_unread_total");
  if (error) throw error;
  return Number(data ?? 0);
}

export async function openDirect(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc("chat_open_direct", { p_user: userId });
  if (error) throw error;
  return data as unknown as string;
}

export async function chatProfile(userId: string): Promise<ChatPeer | null> {
  const { data, error } = await supabase.rpc("chat_profile", { p_user: userId });
  if (error) throw error;
  return (data as unknown as ChatPeer | null) ?? null;
}

export type ChatMember = { user_id: string; last_read_at: string; cleared_at?: string | null; protect_history?: boolean };

/** Both members of a conversation: how far each has read, and whether each keeps their history. */
export async function conversationMembers(conversationId: string): Promise<ChatMember[]> {
  const { data, error } = await loose.from("chat_members").select("*").eq("conversation_id", conversationId);
  if (error) throw error;
  return (data ?? []) as ChatMember[];
}

/** The other member of a conversation. */
export async function conversationPeer(conversationId: string, me: string): Promise<ChatPeer | null> {
  const other = (await conversationMembers(conversationId)).find((row) => row.user_id !== me);
  return other ? chatProfile(other.user_id) : null;
}

export async function peerReadAt(conversationId: string, me: string): Promise<string | null> {
  return (await conversationMembers(conversationId)).find((row) => row.user_id !== me)?.last_read_at ?? null;
}

/** Newest first, `PAGE` at a time; `before` pages further back. Taken-back messages are left out. */
export async function loadMessages(conversationId: string, before?: string): Promise<ChatMessage[]> {
  let query = loose.from("chat_messages").select(MESSAGE_COLUMNS).eq("conversation_id", conversationId)
    .is("deleted_at", null).order("created_at", { ascending: false }).limit(PAGE);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (!error) return (data ?? []) as ChatMessage[];
  // A server from before replies (no `reply_to_id`, no `deleted_at`): the messages still come, plainly.
  if (!isMissingColumn(error)) throw error;
  let plain = loose.from("chat_messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(PAGE);
  if (before) plain = plain.lt("created_at", before);
  const fallback = await plain;
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []) as ChatMessage[];
}

/** Whether PostgREST refused a column or a relationship it does not know (an older database). */
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST200" || error.code === "42703" || /relationship|does not exist/i.test(error.message ?? "");
}

/** One message with its quote: for a reply or a pin that points at something not loaded yet. */
export async function loadMessage(id: string): Promise<ChatMessage | null> {
  const { data } = await loose.from("chat_messages").select(MESSAGE_COLUMNS).eq("id", id).maybeSingle();
  return (data as ChatMessage | null) ?? null;
}

/** The conversation's pins, newest first. */
export async function loadPinned(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await loose.from("chat_messages").select("*").eq("conversation_id", conversationId)
    .not("pinned_at", "is", null).is("deleted_at", null).order("pinned_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export const newClientId = () => Crypto.randomUUID();

export async function sendMessage(input: {
  conversationId: string; kind: ChatKind; body?: string; mediaPath?: string | null;
  media?: ChatMessage["media"]; share?: Pick<ChatShare, "kind" | "id"> | null; clientId: string;
  replyTo?: string | null; items?: ChatItem[] | null;
}): Promise<ChatMessage> {
  const params: Record<string, unknown> = {
    p_conversation_id: input.conversationId,
    p_kind: input.kind,
    p_body: input.body ?? "",
    p_media: input.media ?? {},
    p_client_id: input.clientId,
  };
  // Only what is there is sent, so the call also fits a server that does not know replies or albums yet.
  if (input.mediaPath) params.p_media_path = input.mediaPath;
  if (input.share) params.p_share = input.share;
  if (input.replyTo) params.p_reply_to = input.replyTo;
  if (input.items?.length) params.p_items = input.items;
  const { data, error } = await loose.rpc("chat_send", params);
  if (!error) return data as ChatMessage;
  // A server that does not know replies yet: the words still go, without the quote. Never a message with
  // parts — sent without them, a video would go as its first part alone and an album as nothing, and the
  // other phone would never learn the rest existed. That one fails where it can be seen, and is retried.
  if (error.code === "PGRST202" && params.p_reply_to && !params.p_items) {
    delete params.p_reply_to;
    const plain = await loose.rpc("chat_send", params);
    if (plain.error) throw plain.error;
    return plain.data as ChatMessage;
  }
  throw error;
}

/** Uploads a picture, a voice or a video to the conversation's folder; the path is what the message names. */
export async function uploadChatFile(conversationId: string, me: string, uri: string, mime: string, extension: string): Promise<string> {
  const path = `${conversationId}/${me}/${Crypto.randomUUID()}.${extension}`;
  const body = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase.storage.from("chat-media").upload(path, body, { contentType: mime, upsert: false });
  if (error) throw error;
  return path;
}

/**
 * A recording made on this phone (a voice message) sent to the conversation's folder straight from disk: the
 * phone's own upload task streams the file — the way video notes go up — rather than the file being read into
 * JavaScript and handed to the storage client. The file is looked at first: one that is missing or empty is
 * refused here, with a reason, instead of being sent as a message nobody can play. Answers the path the message
 * names. In a browser (nothing is recorded there) it is the plain upload.
 */
export async function uploadRecording(conversationId: string, me: string, uri: string, mime: string, extension: string): Promise<string> {
  if (Platform.OS === "web") return uploadChatFile(conversationId, me, uri, mime, extension);
  let bytes = 0;
  try {
    const file = new File(localFileUrl(uri));
    bytes = file.exists ? file.size ?? 0 : 0;
  } catch {
    bytes = 0;
  }
  if (bytes <= 0) throw new Error(`recording: the file is missing or empty (${uri})`);
  const path = `${conversationId}/${me}/${Crypto.randomUUID()}.${extension}`;
  const sent = await streamLocalFile({ bucket: "chat-media", path, uri, contentType: mime });
  if (!sent.ok) throw new Error(`recording: upload refused (${sent.message})`);
  return path;
}

/** Smaller than this, a recorded part holds no picture worth sending: a header, a blink. */
const MIN_PART_BYTES = 16_000;

/**
 * Whether a recorded file is there and holds more than a header. A camera that stopped the moment it
 * started — still turning round, or taken by the phone — reports a file all the same, one that is missing
 * or next to empty; sent, it fails the message or plays as a blink. Native only (the web records nothing).
 */
export function hasRecording(uri: string): boolean {
  try {
    const file = new File(uri);
    return file.exists && file.size >= MIN_PART_BYTES;
  } catch {
    return false;
  }
}

/** One part of a video message on its way out: the file recorded here and, once it has landed, where it went. */
export type OutgoingPart = { uri: string; ms: number; mime: string; extension: string; path?: string };

/**
 * Sends a video message's parts to the conversation's folder, all at once and straight from disk: the
 * phone streams each file itself, none is read into JavaScript. A part that lands is reported through
 * `landed` at once, so the caller can remember it — a retry then sends only the parts still missing, and
 * none twice. A part whose file has gone (a cache the phone cleared before a late retry) is left out
 * rather than failing the rest, as long as something is left. Settles only when every part has been
 * tried, and fails if any did not land; the result is the parts in order, as `items` names them.
 */
export async function uploadVideoParts(
  conversationId: string, me: string, parts: OutgoingPart[], landed: (at: number, path: string) => void,
): Promise<ChatItem[]> {
  const going = parts.filter((part) => part.path || hasRecording(part.uri));
  if (!going.length) throw new Error("video message: no recorded part is left to send");
  const settled = await Promise.allSettled(going.map(async (part): Promise<ChatItem> => {
    const duration_ms = Math.round(part.ms);
    if (part.path) return { path: part.path, duration_ms };
    const path = `${conversationId}/${me}/${Crypto.randomUUID()}.${part.extension}`;
    const sent = await streamLocalFile({ bucket: "chat-media", path, uri: part.uri, contentType: part.mime });
    if (!sent.ok) throw new Error(sent.message);
    landed(parts.indexOf(part), path);
    return { path, duration_ms };
  }));
  const items: ChatItem[] = [];
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
    items.push(result.value);
  }
  return items;
}

/**
 * A picture made small enough to send and keep: the long side at most 1280
 * pixels, JPEG at 70% — sharp on a phone, a few hundred kilobytes on the server.
 */
export async function shrinkImage(uri: string, width: number, height: number): Promise<{ uri: string; width: number; height: number }> {
  const long = Math.max(width, height);
  const resize = long > 1280 ? [width >= height ? { resize: { width: 1280 } } : { resize: { height: 1280 } }] : [];
  const small = await ImageManipulator.manipulateAsync(uri, resize, { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
  return { uri: small.uri, width: small.width, height: small.height };
}

export async function markRead(conversationId: string): Promise<void> {
  await supabase.rpc("chat_mark_read", { p_conversation_id: conversationId });
}

export async function saveContact(me: string, contactId: string, patch: { display_name?: string | null; muted?: boolean }): Promise<void> {
  const { error } = await supabase.from("chat_contacts").upsert({ owner_id: me, contact_id: contactId, ...patch }, { onConflict: "owner_id,contact_id" });
  if (error) throw error;
}

export async function searchPeople(term: string): Promise<{ id: string; full_name: string; username: string; avatar_url: string | null }[]> {
  if (term.trim().replace(/^@/, "").length < 2) return [];
  const { data, error } = await supabase.rpc("search_profiles_by_username", { p_query: term.trim().replace(/^@/, ""), p_limit: 15 });
  if (error) throw error;
  return (data as never) ?? [];
}

/** The files of a video message in the order they play: its parts, or the one file. */
export function videoParts(message: Pick<ChatMessage, "media_path" | "items" | "media">): { path: string; ms: number }[] {
  const parts = (message.items ?? []).filter((item) => item.path).map((item) => ({ path: item.path, ms: item.duration_ms ?? 0 }));
  if (parts.length > 1) return parts;
  return message.media_path ? [{ path: message.media_path, ms: message.media.duration_ms ?? 0 }] : [];
}

/**
 * A video message's parts as a player finds them: each one's path, and the file this phone recorded it into
 * when it is the sender's — so one's own note plays from the camera's file while it is still being sent, and
 * from the same file after (the cache has its own copy by then; this is the fallback). A received note has
 * paths only. `localParts` and `localUri` are kept in the order the message names its parts.
 */
export function noteFiles(message: Pick<ChatMessage, "media_path" | "items" | "media" | "localUri" | "localParts">): NoteFile[] {
  const parts = videoParts(message);
  const locals = message.localParts?.length ? message.localParts : message.localUri ? [message.localUri] : [];
  if (!parts.length) return locals.map((local) => ({ path: null, local, ms: 0 }));
  return parts.map((part, at) => ({ path: part.path, local: locals[at] ?? null, ms: part.ms }));
}

/** Short-lived links to chat files, kept for as long as they last. */
const signed = new Map<string, { url: string; until: number }>();

/** A link already signed and still good, at once — or nothing (then `mediaUrl` asks for one). */
export function cachedMediaUrl(path: string): string | null {
  const hit = signed.get(path);
  return hit && hit.until > Date.now() ? hit.url : null;
}
/** When the link kept for a file stops being used (ms since 1970), or null when none is kept: it is renewed before then. */
export function mediaUrlUntil(path: string): number | null {
  return signed.get(path)?.until ?? null;
}
export async function mediaUrl(path: string): Promise<string | null> {
  const hit = signed.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from("chat-media").createSignedUrl(path, 3600);
  if (error || !data) return null;
  signed.set(path, { url: data.signedUrl, until: Date.now() + 3_300_000 });
  return data.signedUrl;
}

/**
 * Links for a page of files in one request, kept like `mediaUrl`'s: in a browser, where nothing is kept on
 * disk, a conversation's voice and video then open without one signing request per bubble. Those already
 * signed are not asked for again — unless `renew` (a link about to run out, replaced before it does); a
 * failure is quiet (each bubble still asks for its own).
 */
export async function signMediaUrls(paths: readonly string[], options: { renew?: boolean } = {}): Promise<void> {
  const wanted = [...new Set(paths)].filter((path) => options.renew || !cachedMediaUrl(path)).slice(0, 100);
  if (!wanted.length) return;
  const { data, error } = await supabase.storage.from("chat-media").createSignedUrls(wanted, 3600);
  if (error || !data) return;
  const until = Date.now() + 3_300_000;
  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) signed.set(entry.path, { url: entry.signedUrl, until });
  }
}

/**
 * Which of these chat files a message this person can still see names (500 at most in one call): the phone
 * keeps no file whose message was taken back, cleared or hidden, wherever that happened. Throws on any
 * failure — a lost connection, a server without the check yet — so that nothing is dropped on a guess.
 */
export async function chatMediaAlive(paths: readonly string[]): Promise<string[]> {
  const { data, error } = await loose.rpc("chat_media_alive", { p_paths: paths });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("chat_media_alive: no list in the answer");
  return data.filter((path): path is string => typeof path === "string");
}

/** New messages in one conversation, every change to them, and the members' own rows (reading, clearing). */
export function followConversation(conversationId: string, handlers: {
  onMessage: (message: ChatMessage) => void;
  /** An edit, a reaction, a pin, or the message taken back (`deleted_at`). */
  onChange?: (message: ChatMessage) => void;
  onMember: (member: ChatMember) => void;
}): RealtimeChannel {
  return changesChannel(`chat-${conversationId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${conversationId}` },
      (payload) => handlers.onMessage(payload.new as ChatMessage))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${conversationId}` },
      (payload) => handlers.onChange?.(payload.new as ChatMessage))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_members", filter: `conversation_id=eq.${conversationId}` },
      (payload) => handlers.onMember(payload.new as ChatMember))
    .subscribe();
}

/** Any new message to me, anywhere: for the list and the badge. */
export function followInbox(onChange: () => void): RealtimeChannel {
  return changesChannel("chat-inbox")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, onChange)
    .subscribe();
}

/**
 * A shared deck, game or scientific work, copied into the caller's own
 * library (`chat-library`): a deck comes with its defence script. Answers
 * where it now is, so it can be opened at once.
 */
export async function addToLibrary(messageId: string): Promise<{ kind: ChatShare["kind"]; id: string }> {
  const { data, error } = await supabase.functions.invoke("chat-library", { body: { messageId } });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context && typeof (context as Response).json === "function") {
      const body = await (context as Response).json().catch(() => null) as { error?: string } | null;
      if (body?.error) throw new Error(body.error);
    }
    throw error;
  }
  return data as { kind: ChatShare["kind"]; id: string };
}

/** Where a thing in the library opens. */
export function libraryHref(kind: ChatShare["kind"], id: string): string {
  return kind === "presentation" ? `/(app)/presentation/${id}` : kind === "game" ? `/(app)/oyingoh/${id}` : "/(app)/ilmiy";
}

/**
 * What was sent in a conversation beyond words: for the profile's tabs,
 * newest first. An album counts as its pictures, one by one.
 */
export async function sharedInConversation(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await loose.from("chat_messages").select("*")
    .eq("conversation_id", conversationId).in("kind", ["image", "video", "voice", "share", "album"]).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  return ((data ?? []) as ChatMessage[]).flatMap((message) => (message.kind === "album"
    ? (message.items ?? []).map((item, at): ChatMessage => ({
        ...message, id: `${message.id}:${at}`, kind: "image", media_path: item.path, items: null,
        media: { width: item.width ?? undefined, height: item.height ?? undefined },
      }))
    : [message]));
}

/* ------------------------------------------------- blocking and presence */

/** Whether a failure was the server refusing a message between blocked people. */
export function isBlockedFailure(failure: unknown): boolean {
  const value = failure as { code?: string; details?: string; message?: string } | null;
  return value?.code === "42501" && (value.details === "blocked" || /yuborib bo/.test(value.message ?? ""));
}

export async function blockUser(userId: string): Promise<void> {
  const { error } = await loose.rpc("chat_block", { p_user: userId });
  if (error) throw error;
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await loose.rpc("chat_unblock", { p_user: userId });
  if (error) throw error;
}

/** Whether someone is here, and when they last were — nothing at all if either blocked the other. */
export async function peerStatus(userId: string): Promise<{ online: boolean; last_seen_at: string | null }> {
  const { data, error } = await loose.rpc("chat_peer_status", { p_user: userId });
  if (error) throw error;
  return (data ?? { online: false, last_seen_at: null }) as { online: boolean; last_seen_at: string | null };
}

/** The open app saying it is here, or going to the background. */
export async function touchPresence(online: boolean): Promise<void> {
  await loose.rpc("chat_touch", { p_online: online });
}

/* ----------------------------------------- editing, and what else a message does */

/** The sender's correction of a message. */
export async function editMessage(id: string, body: string): Promise<ChatMessage> {
  const { data, error } = await loose.rpc("chat_edit", { p_message_id: id, p_body: body });
  if (error) throw error;
  return data as ChatMessage;
}

/** Messages the sender may still correct: their own words (or caption), not passed on, under 48 hours old. */
export function editable(message: ChatMessage, me: string): boolean {
  return message.sender_id === me && !message.pending && message.kind !== "share" && !message.forward_from_id
    && (message.kind === "text" || Boolean(message.body))
    && Date.now() - new Date(message.created_at).getTime() < 48 * 3_600_000;
}

/** One reaction each: the same emoji again takes it back. Answers everyone's reactions as they now stand. */
export async function reactTo(messageId: string, emoji: string | null): Promise<Record<string, string>> {
  const { data, error } = await loose.rpc("chat_react", { p_message_id: messageId, p_emoji: emoji ?? "" });
  if (error) throw error;
  return (data ?? {}) as Record<string, string>;
}

export async function pinMessage(messageId: string, pinned: boolean): Promise<ChatMessage> {
  const { data, error } = await loose.rpc("chat_pin", { p_message_id: messageId, p_pinned: pinned });
  if (error) throw error;
  return data as ChatMessage;
}

export async function forwardMessages(messageIds: string[], conversationIds: string[]): Promise<number> {
  const { data, error } = await loose.rpc("chat_forward", { p_message_ids: messageIds, p_conversation_ids: conversationIds });
  if (error) throw error;
  return Number(data ?? 0);
}

/** For both (one's own only) or for oneself. */
export async function deleteMessages(messageIds: string[], forEveryone: boolean): Promise<number> {
  const { data, error } = await loose.rpc("chat_delete", { p_message_ids: messageIds, p_for_everyone: forEveryone });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function clearChat(conversationId: string, forEveryone: boolean): Promise<void> {
  const { error } = await loose.rpc("chat_clear", { p_conversation_id: conversationId, p_for_everyone: forEveryone });
  if (error) throw error;
}

/** Whether a failure was the other side keeping their history. */
export function isProtectedFailure(failure: unknown): boolean {
  const value = failure as { code?: string; details?: string } | null;
  return value?.code === "42501" && value.details === "protected";
}

export async function protectHistory(conversationId: string, on: boolean): Promise<void> {
  const { error } = await loose.rpc("chat_protect_history", { p_conversation_id: conversationId, p_on: on });
  if (error) throw error;
}

export type ReportReason = "spam" | "abuse" | "sexual" | "violence" | "fraud" | "other";
export const REPORT_REASONS: ReportReason[] = ["spam", "abuse", "sexual", "violence", "fraud", "other"];

export async function reportChat(conversationId: string, reason: ReportReason, messageId?: string | null, note?: string): Promise<void> {
  const params: Record<string, unknown> = { p_conversation_id: conversationId, p_reason: reason };
  if (messageId) params.p_message_id = messageId;
  if (note?.trim()) params.p_note = note.trim();
  const { error } = await loose.rpc("chat_report", params);
  if (error) throw error;
}

/* ------------------------------------------------------ small pure helpers */

/** Reactions gathered for showing: each emoji with how many, and whether one of them is mine; most first. */
export function reactionChips(reactions: Record<string, string> | undefined, me: string): { emoji: string; count: number; mine: boolean }[] {
  const chips = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const [user, emoji] of Object.entries(reactions ?? {})) {
    const chip = chips.get(emoji) ?? { emoji, count: 0, mine: false };
    chip.count += 1;
    if (user === me) chip.mine = true;
    chips.set(emoji, chip);
  }
  return [...chips.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

const PICTOGRAPH_RANGES: [number, number][] = [
  [0x1f000, 0x1faff], [0x2600, 0x27bf], [0x2300, 0x23ff], [0x2b00, 0x2bff], [0x2190, 0x21ff], [0x25a0, 0x25ff], [0x2900, 0x297f],
];
const PICTOGRAPH_SINGLES = new Set([0x00a9, 0x00ae, 0x203c, 0x2049, 0x2122, 0x2139, 0x24c2, 0x3030, 0x303d, 0x3297, 0x3299]);

/**
 * How many emoji a message is, when it is nothing but one to three of them —
 * those arrive as a big sticker, not a bubble. Zero otherwise. Joined emoji
 * (a family, a flag, a skin tone) count once.
 */
export function emojiCount(text: string): number {
  const value = text.replace(/\s+/g, "");
  if (!value || value.length > 48) return 0;
  let bases = 0;
  let regional = 0;
  let joined = false;
  for (const char of Array.from(value)) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x200d) { joined = true; continue; }
    // Variation selectors, the keycap, skin tones and flag tags dress the emoji before them.
    if (code === 0xfe0f || code === 0xfe0e || code === 0x20e3 || (code >= 0x1f3fb && code <= 0x1f3ff) || (code >= 0xe0020 && code <= 0xe007f)) continue;
    if (code >= 0x1f1e6 && code <= 0x1f1ff) { regional += 1; continue; }
    const pictograph = PICTOGRAPH_SINGLES.has(code) || PICTOGRAPH_RANGES.some(([from, to]) => code >= from && code <= to);
    if (!pictograph) return 0;
    if (!joined) bases += 1;
    joined = false;
  }
  const count = bases + Math.floor(regional / 2);
  return count >= 1 && count <= 3 ? count : 0;
}

/* ------------------------------------------------- what can be sent from here */

export type Shareable = { kind: ChatShare["kind"]; id: string; title: string; created_at: string };

/** One's own finished decks, games and scientific works, newest first: what the attach sheet offers. */
export async function myShareables(me: string): Promise<Shareable[]> {
  const [decks, games, works] = await Promise.all([
    loose.from("presentations").select("id, title, created_at").eq("owner_id", me).eq("status", "ready")
      .order("created_at", { ascending: false }).limit(60),
    loose.from("games").select("id, title, kind, created_at").eq("owner_id", me).eq("status", "ready").neq("kind", "mafia")
      .order("created_at", { ascending: false }).limit(60),
    loose.from("academic_works").select("id, topic, created_at").eq("owner_id", me).eq("status", "ready")
      .order("created_at", { ascending: false }).limit(60),
  ]);
  const first = decks.error ?? games.error ?? works.error;
  if (first) throw first;
  type Row = { id: string; title?: string | null; topic?: string | null; created_at: string };
  return [
    ...((decks.data ?? []) as Row[]).map((row): Shareable => ({ kind: "presentation", id: row.id, title: row.title?.trim() || "—", created_at: row.created_at })),
    ...((games.data ?? []) as Row[]).map((row): Shareable => ({ kind: "game", id: row.id, title: row.title?.trim() || "—", created_at: row.created_at })),
    ...((works.data ?? []) as Row[]).map((row): Shareable => ({ kind: "academic", id: row.id, title: row.topic?.trim() || "—", created_at: row.created_at })),
  ];
}
