import type { RealtimeChannel } from "@supabase/supabase-js";
import * as Crypto from "expo-crypto";

import { changesChannel, supabase } from "@/lib/supabase";

/**
 * Chat: one-to-one conversations (`chat_*` in the database).
 *
 * Messages are written only through `chat_send`, read by row-level security,
 * and arrive on the other phone through Realtime on `chat_messages`. Files go
 * to `chat-media/<conversation>/<me>/<file>` first, then the message names
 * them. Every send carries a client id, so a send repeated after a dropped
 * connection is still one message.
 */

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

export type ChatListItem = {
  id: string;
  peer: ChatPeer;
  peer_read_at: string;
  last: { kind: ChatKind; body: string; sender_id: string | null; created_at: string; share_title: string | null } | null;
  unread: number;
};

export type ChatKind = "text" | "image" | "voice" | "video" | "share";
export type ChatShare = { kind: "presentation" | "game" | "academic"; id: string; title: string };

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  kind: ChatKind;
  body: string;
  media_path: string | null;
  media: { width?: number; height?: number; duration_ms?: number; mime?: string };
  share: ChatShare | null;
  client_id: string | null;
  created_at: string;
  /** Set when the sender corrected it. */
  edited_at?: string | null;
  /** Only on this phone: sent but not yet confirmed, or failed. */
  pending?: "sending" | "failed";
  /** Only on this phone: the file being sent, shown before it is uploaded. */
  localUri?: string;
};

export const VOICE_MAX_MS = 120_000;
export const VIDEO_MAX_MS = 60_000;
const PAGE = 40;

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

/** The other member of a conversation. */
export async function conversationPeer(conversationId: string, me: string): Promise<ChatPeer | null> {
  const { data, error } = await supabase.from("chat_members").select("user_id, last_read_at").eq("conversation_id", conversationId);
  if (error) throw error;
  const other = (data ?? []).find((row) => row.user_id !== me);
  return other ? chatProfile(other.user_id) : null;
}

export async function peerReadAt(conversationId: string, me: string): Promise<string | null> {
  const { data } = await supabase.from("chat_members").select("user_id, last_read_at").eq("conversation_id", conversationId);
  return (data ?? []).find((row) => row.user_id !== me)?.last_read_at ?? null;
}

/** Newest first, `PAGE` at a time; `before` pages further back. */
export async function loadMessages(conversationId: string, before?: string): Promise<ChatMessage[]> {
  let query = supabase.from("chat_messages").select("*").eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(PAGE);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ChatMessage[];
}

export const newClientId = () => Crypto.randomUUID();

export async function sendMessage(input: {
  conversationId: string; kind: ChatKind; body?: string; mediaPath?: string | null;
  media?: ChatMessage["media"]; share?: Pick<ChatShare, "kind" | "id"> | null; clientId: string;
}): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc("chat_send", {
    p_conversation_id: input.conversationId,
    p_kind: input.kind,
    p_body: input.body ?? "",
    p_media_path: input.mediaPath ?? undefined,
    p_media: (input.media ?? {}) as never,
    p_share: (input.share ?? undefined) as never,
    p_client_id: input.clientId,
  });
  if (error) throw error;
  return data as unknown as ChatMessage;
}

/** Uploads a picture, a voice or a video to the conversation's folder; the path is what the message names. */
export async function uploadChatFile(conversationId: string, me: string, uri: string, mime: string, extension: string): Promise<string> {
  const path = `${conversationId}/${me}/${Crypto.randomUUID()}.${extension}`;
  const body = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase.storage.from("chat-media").upload(path, body, { contentType: mime, upsert: false });
  if (error) throw error;
  return path;
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

/** Short-lived links to chat files, kept for as long as they last. */
const signed = new Map<string, { url: string; until: number }>();
export async function mediaUrl(path: string): Promise<string | null> {
  const hit = signed.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from("chat-media").createSignedUrl(path, 3600);
  if (error || !data) return null;
  signed.set(path, { url: data.signedUrl, until: Date.now() + 3_300_000 });
  return data.signedUrl;
}

/** New messages in one conversation, corrections to them, and the other side reading them. */
export function followConversation(conversationId: string, handlers: {
  onMessage: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onRead: (userId: string, at: string) => void;
}): RealtimeChannel {
  return changesChannel(`chat-${conversationId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${conversationId}` },
      (payload) => handlers.onMessage(payload.new as ChatMessage))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${conversationId}` },
      (payload) => handlers.onEdit?.(payload.new as ChatMessage))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_members", filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        const row = payload.new as { user_id: string; last_read_at: string };
        handlers.onRead(row.user_id, row.last_read_at);
      })
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

/** What was sent in a conversation beyond words: for the profile's tabs, newest first. */
export async function sharedInConversation(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase.from("chat_messages").select("*")
    .eq("conversation_id", conversationId).in("kind", ["image", "video", "voice", "share"])
    .order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  return (data ?? []) as unknown as ChatMessage[];
}

/* ------------------------------------------------- blocking and presence */

/** Whether a failure was the server refusing a message between blocked people. */
export function isBlockedFailure(failure: unknown): boolean {
  const value = failure as { code?: string; details?: string; message?: string } | null;
  return value?.code === "42501" && (value.details === "blocked" || /yuborib bo/.test(value.message ?? ""));
}

export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("chat_block" as never, { p_user: userId } as never);
  if (error) throw error;
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("chat_unblock" as never, { p_user: userId } as never);
  if (error) throw error;
}

/** Whether someone is here, and when they last were — nothing at all if either blocked the other. */
export async function peerStatus(userId: string): Promise<{ online: boolean; last_seen_at: string | null }> {
  const { data, error } = await supabase.rpc("chat_peer_status" as never, { p_user: userId } as never);
  if (error) throw error;
  return (data ?? { online: false, last_seen_at: null }) as { online: boolean; last_seen_at: string | null };
}

/** The open app saying it is here, or going to the background. */
export async function touchPresence(online: boolean): Promise<void> {
  await supabase.rpc("chat_touch" as never, { p_online: online } as never);
}

/** The sender's correction of a message. */
export async function editMessage(id: string, body: string): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc("chat_edit" as never, { p_message_id: id, p_body: body } as never);
  if (error) throw error;
  return data as unknown as ChatMessage;
}

/** Messages the sender may still correct: their own text (or caption) under 48 hours old. */
export function editable(message: ChatMessage, me: string): boolean {
  return message.sender_id === me && !message.pending && message.kind !== "share"
    && (message.kind === "text" || Boolean(message.body))
    && Date.now() - new Date(message.created_at).getTime() < 48 * 3_600_000;
}
