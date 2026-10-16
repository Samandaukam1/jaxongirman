import { supabase } from "./supabase";

/**
 * The support desk as the console works it.
 *
 * Every answer is typed by a member of staff — nothing here drafts, suggests
 * or sends a reply on anyone's behalf. Each call is the server's support
 * function, which checks the caller's role itself; the console only decides
 * what to draw.
 */

export type TicketStatus = "open" | "in_progress" | "waiting_for_user" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Ochiq",
  in_progress: "Jarayonda",
  waiting_for_user: "Foydalanuvchi javobi kutilmoqda",
  resolved: "Hal qilindi",
  closed: "Yopilgan",
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = { low: "Past", normal: "Oddiy", high: "Yuqori", urgent: "Shoshilinch" };

export const CATEGORY_LABELS: Record<string, string> = {
  payments: "To‘lovlar", jtanga: "J Tanga", presentations: "Taqdimotlar", oyingoh: "O‘yingoh",
  marketplace: "Marketplace", account: "Hisob va profil", technical: "Texnik muammo", feedback: "Taklif va shikoyat", other: "Boshqa",
};

export type InboxRow = {
  id: string; ticket_number: string; category: string; subject: string; status: TicketStatus; priority: TicketPriority;
  staff_unread: number; assignee_id: string | null; assignee_name: string | null; user_name: string | null; username: string | null;
  last_message_at: string; created_at: string;
};

export type Inbox = {
  tickets: InboxRow[];
  counts: { unread: number; open: number; in_progress: number; waiting_for_user: number; mine: number; unassigned: number };
};

export type Attachment = { id: string; path: string; mime_type: string | null; size: number | null };
export type Message = {
  id: string; author_kind: "user" | "staff" | "system"; author_name: string | null; is_internal: boolean;
  body: string; created_at: string; attachments: Attachment[];
};
export type Ticket = InboxRow & {
  user_id: string; related_order_number: string | null; related_presentation_title: string | null;
  related_transaction_ref: string | null; reopened_count: number; first_response_at: string | null;
};
export type TicketDetail = { ticket: Ticket; messages: Message[] };

export type TicketContext = {
  user: { id: string; full_name: string | null; username: string | null; status: string; joined_at: string } | null;
  plan: { code: string; name: string; expires_at: string } | null;
  wallet: { balance: number; reserved: number } | null;
  pages: { welcome: number; bought: number } | null;
  orders: { order_number: string; purpose: string; status: string; total_amount: number; created_at: string; paid_at: string | null }[];
  related_order: { order_number: string; purpose: string; status: string; total_amount: number; created_at: string; paid_at: string | null; failure_message: string | null } | null;
  related_presentation: { id: string; title: string; status: string; slides: number; created_at: string; error_message: string | null } | null;
  events: { kind: string; from: string | null; to: string | null; actor: string | null; created_at: string }[];
};

export type StaffMember = { id: string; full_name: string | null; role: string };
export type Metrics = { open_total: number; created_7d: number; resolved_7d: number; median_first_response_minutes_30d: number | null; by_category_30d: Record<string, number> };

/** Untyped call: the support functions are newer than the types this panel was vendored with. */
async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const loadInbox = (filters: Record<string, string | number | undefined>) =>
  call<Inbox>("support_inbox", { p_filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")) });
export const loadTicket = (id: string) => call<TicketDetail>("support_ticket_detail", { p_ticket_id: id });
export const loadContext = (id: string) => call<TicketContext>("support_ticket_context", { p_ticket_id: id });
export const loadStaff = () => call<StaffMember[]>("support_staff_list");
export const loadMetrics = () => call<Metrics>("support_metrics");

export const staffReply = (id: string, body: string, internal: boolean, attachments: string[], status: TicketStatus | null) =>
  call<TicketDetail>("support_staff_reply", { p_ticket_id: id, p_body: body, p_internal: internal, p_attachments: attachments, p_status: status });

export const updateTicket = (id: string, changes: { status?: TicketStatus; priority?: TicketPriority; assigneeId?: string | null; unassign?: boolean }) =>
  call<TicketDetail>("support_update_ticket", {
    p_ticket_id: id, p_status: changes.status ?? null, p_priority: changes.priority ?? null,
    p_assignee_id: changes.assigneeId ?? null, p_unassign: changes.unassign ?? false,
  });

export const setSupportRole = (email: string, role: "support_agent" | "support_manager", grant: boolean) =>
  call<{ user_id: string }>("admin_set_support_role", { p_email: email, p_role: role, p_grant: grant });

/** Zero when the desk cannot be read, so a badge never breaks the sidebar. */
export async function supportUnreadCount(): Promise<number> {
  try {
    return (await loadInbox({ status: "active", limit: 1 })).counts.unread;
  } catch {
    return 0;
  }
}

const BUCKET = "support-attachments";

export async function uploadAttachment(userId: string, file: File): Promise<string> {
  const extension = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function attachmentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  return error ? null : data.signedUrl;
}
