import * as Crypto from "expo-crypto";
import type { ImagePickerAsset } from "expo-image-picker";

import { i18n } from "../i18n";

import { supabase } from "./supabase";

/**
 * Yordam markazi.
 *
 * A person and the people who answer them — nothing in between: every reply
 * on a ticket is written by a member of the support staff. Everything here is
 * a call to the server's support functions; a screenshot is uploaded to the
 * private `support-attachments` bucket under the person's own folder and only
 * then attached, by path, so the server can check it is theirs.
 */

/** The topics a ticket can be filed under; their names are in the `support` table. */
export const SUPPORT_CATEGORIES = [
  { key: "payments" }, { key: "jtanga" }, { key: "presentations" }, { key: "oyingoh" }, { key: "marketplace" },
  { key: "account" }, { key: "technical" }, { key: "feedback" }, { key: "other" },
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]["key"];
export type SupportStatus = "open" | "in_progress" | "waiting_for_user" | "resolved" | "closed";

export const statusLabel = (status: SupportStatus): string => i18n.t(`support:status.${status}`);

export const categoryLabel = (key: string): string =>
  SUPPORT_CATEGORIES.some((item) => item.key === key) ? i18n.t(`support:category.${key as SupportCategory}`) : key;

export type TicketSummary = {
  id: string;
  ticket_number: string;
  category: string;
  subject: string;
  status: SupportStatus;
  user_unread: number;
  last_message_at: string;
  created_at: string;
};

export type TicketAttachment = { id: string; path: string; mime_type: string | null; size: number | null };

export type TicketMessage = {
  id: string;
  author_kind: "user" | "staff" | "system";
  author_name: string | null;
  body: string;
  created_at: string;
  attachments: TicketAttachment[];
};

export type TicketDetail = {
  ticket: TicketSummary & {
    related_order_number: string | null;
    related_presentation_title: string | null;
    related_transaction_ref: string | null;
    resolved_at: string | null;
  };
  messages: TicketMessage[];
};

const BUCKET = "support-attachments";

export async function myTickets(): Promise<TicketSummary[]> {
  const { data, error } = await supabase.rpc("my_support_tickets");
  if (error) throw error;
  return (data ?? []) as unknown as TicketSummary[];
}

export async function ticketDetail(id: string): Promise<TicketDetail> {
  const { data, error } = await supabase.rpc("support_ticket_detail", { p_ticket_id: id });
  if (error) throw error;
  return data as unknown as TicketDetail;
}

/** Zero on a server without the support desk, so a badge never breaks a screen. */
export async function supportUnread(): Promise<number> {
  const { data, error } = await supabase.rpc("support_unread_count");
  if (error) return 0;
  return Number(data ?? 0);
}

export async function createTicket(input: {
  category: SupportCategory;
  subject: string;
  body: string;
  orderNumber?: string;
  transactionRef?: string;
  presentationId?: string;
  attachments: string[];
}): Promise<{ id: string; ticket_number: string }> {
  const { data, error } = await supabase.rpc("support_create_ticket", {
    p_category: input.category,
    p_subject: input.subject.trim(),
    p_body: input.body.trim(),
    p_order_number: input.orderNumber?.trim() || undefined,
    p_transaction_ref: input.transactionRef?.trim() || undefined,
    p_presentation_id: input.presentationId || undefined,
    p_attachments: input.attachments,
  });
  if (error) throw error;
  return data as unknown as { id: string; ticket_number: string };
}

export async function replyToTicket(id: string, body: string, attachments: string[]): Promise<TicketDetail> {
  const { data, error } = await supabase.rpc("support_reply", { p_ticket_id: id, p_body: body.trim(), p_attachments: attachments });
  if (error) throw error;
  return data as unknown as TicketDetail;
}

export async function reopenTicket(id: string): Promise<TicketDetail> {
  const { data, error } = await supabase.rpc("support_reopen", { p_ticket_id: id });
  if (error) throw error;
  return data as unknown as TicketDetail;
}

/**
 * Uploads a screenshot into the person's own folder and returns its path.
 *
 * Bytes, not a Blob: React Native's Blob carries no usable type, and the
 * bucket accepts images and PDFs only.
 */
export async function uploadSupportImage(userId: string, asset: ImagePickerAsset): Promise<string> {
  const response = await fetch(asset.uri);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(i18n.t("support:image.unreadable"));
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error(i18n.t("support:image.tooLarge"));
  const contentType = asset.mimeType && /^image\/(jpeg|png|webp|heic)$/.test(asset.mimeType) ? asset.mimeType : "image/jpeg";
  const extension = contentType.split("/")[1] === "jpeg" ? "jpg" : contentType.split("/")[1];
  const path = `${userId}/${Crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
  return path;
}

/** A short-lived link to view an attachment; the bucket is private. */
export async function attachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  return error ? null : data.signedUrl;
}

/** Common questions, answered once, so a person need not wait for a reply to read them. Words are in the `support` table. */
export const FAQ = ["payment", "planCoins", "welcome", "refund", "pages", "reply"] as const;
