import { Lock, Paperclip, RefreshCw, Search, Send, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorState, Modal, PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import {
  CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS,
  attachmentUrl, loadContext, loadInbox, loadMetrics, loadStaff, loadTicket, setSupportRole, staffReply, updateTicket, uploadAttachment,
  type Attachment, type Inbox, type Metrics, type StaffMember, type TicketContext, type TicketDetail, type TicketPriority, type TicketStatus,
} from "@/lib/support";
import { useAuth } from "@/providers/AuthProvider";

/** How often the open inbox and ticket look for something new. */
const POLL_MS = 20_000;

/**
 * Support.
 *
 * The inbox on the left, the conversation in the middle, what the desk may
 * know about the person on the right. Every reply is typed here by a member of
 * staff; an internal note stays with the staff. Agents answer and take
 * tickets; managers also hand them to others; super admins choose who works
 * the desk.
 */
export function SupportPage() {
  const { session, isSuperAdmin, isSupportManager } = useAuth();
  const me = session?.user.id ?? "";
  const [filters, setFilters] = useState({ status: "active", priority: "", category: "", assignee: "", search: "" });
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [context, setContext] = useState<TicketContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);

  const refreshInbox = useCallback(async () => {
    try {
      setInbox(await loadInbox(filters));
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, [filters]);

  const refreshTicket = useCallback(async (id: string) => {
    try {
      const [nextDetail, nextContext] = await Promise.all([loadTicket(id), loadContext(id)]);
      setDetail(nextDetail);
      setContext(nextContext);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, []);

  useEffect(() => {
    void refreshInbox();
    const timer = window.setInterval(() => void refreshInbox(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshInbox]);

  useEffect(() => {
    void loadStaff().then(setStaff).catch(() => setStaff([]));
    void loadMetrics().then(setMetrics).catch(() => setMetrics(null));
  }, []);

  useEffect(() => {
    if (!selected) return;
    void refreshTicket(selected);
    const timer = window.setInterval(() => void refreshTicket(selected), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshTicket, selected]);

  const setFilter = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  async function change(changes: Parameters<typeof updateTicket>[1]) {
    if (!selected) return;
    try {
      setDetail(await updateTicket(selected, changes));
      await Promise.all([refreshInbox(), refreshTicket(selected)]);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="SUPPORT"
        title="Yordam markazi"
        description="Foydalanuvchi murojaatlari. Har bir javobni xodim o‘zi yozadi; ichki eslatmalar foydalanuvchiga ko‘rinmaydi."
        action={isSuperAdmin ? (
          <button className="secondary-button" type="button" onClick={() => setStaffOpen(true)}><Users size={16} /> Xodimlar</button>
        ) : undefined}
      />

      {metrics ? (
        <div className="metric-grid">
          <div className="metric-card"><span>Ochiq murojaatlar</span><strong>{metrics.open_total}</strong></div>
          <div className="metric-card"><span>Javobsiz (o‘qilmagan)</span><strong>{inbox?.counts.unread ?? "—"}</strong></div>
          <div className="metric-card"><span>Biriktirilmagan</span><strong>{inbox?.counts.unassigned ?? "—"}</strong></div>
          <div className="metric-card"><span>7 kunda yangi / hal qilingan</span><strong>{metrics.created_7d} / {metrics.resolved_7d}</strong></div>
          <div className="metric-card"><span>Birinchi javob (median, 30 kun)</span><strong>{metrics.median_first_response_minutes_30d != null ? `${metrics.median_first_response_minutes_30d} daq` : "—"}</strong></div>
        </div>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => void refreshInbox()} /> : null}

      <div className="support-layout">
        <section className="panel flush support-inbox">
          <div className="support-filters">
            <label className="support-search"><Search size={15} />
              <input value={filters.search} onChange={(e) => setFilter("search", e.target.value)} placeholder="Raqam, sarlavha yoki ism" />
            </label>
            <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="active">Faol</option>
              {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              <option value="all">Hammasi</option>
            </select>
            <select value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)}>
              <option value="">Har qanday muhimlik</option>
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select value={filters.category} onChange={(e) => setFilter("category", e.target.value)}>
              <option value="">Barcha bo‘limlar</option>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select value={filters.assignee} onChange={(e) => setFilter("assignee", e.target.value)}>
              <option value="">Hamma xodimlar</option>
              <option value="me">Menga biriktirilgan ({inbox?.counts.mine ?? 0})</option>
              <option value="unassigned">Biriktirilmagan ({inbox?.counts.unassigned ?? 0})</option>
              {staff.map((member) => <option key={member.id} value={member.id}>{member.full_name ?? member.id.slice(0, 8)}</option>)}
            </select>
          </div>
          <div className="support-list">
            {(inbox?.tickets ?? []).map((ticket) => (
              <button key={ticket.id} type="button" className={`support-row${selected === ticket.id ? " active" : ""}`} onClick={() => setSelected(ticket.id)}>
                <span className="support-row-top">
                  <span className={`support-priority p-${ticket.priority}`}>{PRIORITY_LABELS[ticket.priority]}</span>
                  <span className="muted">{ticket.ticket_number}</span>
                  {ticket.staff_unread > 0 ? <em className="support-unread">{ticket.staff_unread}</em> : null}
                </span>
                <strong>{ticket.subject}</strong>
                <span className="muted">{ticket.user_name ?? ticket.username ?? "—"} · {CATEGORY_LABELS[ticket.category] ?? ticket.category}</span>
                <span className="muted">{STATUS_LABELS[ticket.status]} · {ticket.assignee_name ?? "biriktirilmagan"} · {new Date(ticket.last_message_at).toLocaleString("uz-UZ")}</span>
              </button>
            ))}
            {inbox && inbox.tickets.length === 0 ? <p className="muted support-empty">Bu filtr bo‘yicha murojaat yo‘q.</p> : null}
          </div>
        </section>

        {detail && selected ? (
          <Conversation
            detail={detail}
            me={me}
            staff={staff}
            canAssignOthers={isSupportManager}
            onChange={(changes) => void change(changes)}
            onSent={async (next) => { setDetail(next); await refreshInbox(); }}
            onRefresh={() => void refreshTicket(selected)}
          />
        ) : (
          <section className="panel support-placeholder"><p className="muted">Chap tomondan murojaatni tanlang.</p></section>
        )}

        {context && selected ? <ContextPanel context={context} /> : null}
      </div>

      {staffOpen ? <StaffModal staff={staff} onClose={() => setStaffOpen(false)} onChanged={async () => setStaff(await loadStaff())} /> : null}
    </div>
  );
}

/* --------------------------------------------------------- conversation */

function Conversation({ detail, me, staff, canAssignOthers, onChange, onSent, onRefresh }: {
  detail: TicketDetail; me: string; staff: StaffMember[]; canAssignOthers: boolean;
  onChange: (changes: Parameters<typeof updateTicket>[1]) => void;
  onSent: (next: TicketDetail) => Promise<void>;
  onRefresh: () => void;
}) {
  const { ticket, messages } = detail;
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState<TicketStatus | "">("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const paths: string[] = [];
      for (const file of files) paths.push(await uploadAttachment(me, file));
      const next = await staffReply(ticket.id, body.trim(), internal, paths, after || null);
      setBody("");
      setFiles([]);
      setInternal(false);
      setAfter("");
      await onSent(next);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel support-thread">
      <div className="support-thread-head">
        <div>
          <span className="muted">{ticket.ticket_number} · {CATEGORY_LABELS[ticket.category] ?? ticket.category}{ticket.reopened_count ? ` · ${ticket.reopened_count} marta qayta ochilgan` : ""}</span>
          <h2>{ticket.subject}</h2>
          {ticket.related_order_number || ticket.related_transaction_ref || ticket.related_presentation_title ? (
            <span className="muted">
              {[ticket.related_order_number && `Buyurtma ${ticket.related_order_number}`, ticket.related_transaction_ref && `Tranzaksiya ${ticket.related_transaction_ref}`,
                ticket.related_presentation_title && `Taqdimot “${ticket.related_presentation_title}”`].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </div>
        <button className="icon-button" type="button" title="Yangilash" onClick={onRefresh}><RefreshCw size={16} /></button>
      </div>

      <div className="support-controls">
        <label>Holat
          <select value={ticket.status} onChange={(e) => onChange({ status: e.target.value as TicketStatus })}>
            {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>Muhimlik
          <select value={ticket.priority} onChange={(e) => onChange({ priority: e.target.value as TicketPriority })}>
            {Object.entries(PRIORITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>Mas’ul
          <select
            value={ticket.assignee_id ?? ""}
            onChange={(e) => onChange(e.target.value ? { assigneeId: e.target.value } : { unassign: true })}
          >
            <option value="">Biriktirilmagan</option>
            {staff.filter((member) => canAssignOthers || member.id === me || member.id === ticket.assignee_id).map((member) => (
              <option key={member.id} value={member.id}>{member.full_name ?? member.id.slice(0, 8)}{member.id === me ? " (men)" : ""}</option>
            ))}
          </select>
        </label>
        {ticket.assignee_id !== me ? (
          <button className="secondary-button compact" type="button" onClick={() => onChange({ assigneeId: me })}><UserPlus size={14} /> O‘zimga olish</button>
        ) : null}
      </div>

      <div className="support-messages">
        {messages.map((message) => (
          <div key={message.id} className={`support-message ${message.author_kind === "user" ? "from-user" : "from-staff"}${message.is_internal ? " internal" : ""}`}>
            <div className="support-message-head">
              <strong>{message.is_internal ? <><Lock size={12} /> Ichki eslatma · </> : null}{message.author_kind === "user" ? (message.author_name ?? "Foydalanuvchi") : (message.author_name ?? "Xodim")}</strong>
              <span className="muted">{new Date(message.created_at).toLocaleString("uz-UZ")}</span>
            </div>
            <p>{message.body}</p>
            {message.attachments.length ? (
              <div className="support-files">{message.attachments.map((file) => <AttachmentLink key={file.id} file={file} />)}</div>
            ) : null}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {ticket.status !== "closed" ? (
        <div className={`support-composer${internal ? " internal" : ""}`}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={5000}
            placeholder={internal ? "Faqat xodimlar ko‘radigan eslatma…" : "Foydalanuvchiga javob yozing…"} />
          <div className="support-composer-row">
            <label className="checkbox"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Ichki eslatma</label>
            <label className="support-attach"><Paperclip size={15} /> {files.length ? `${files.length} ta fayl` : "Fayl"}
              <input type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
            </label>
            {!internal ? (
              <select value={after} onChange={(e) => setAfter(e.target.value as TicketStatus | "")}>
                <option value="">Keyin: javob kutilmoqda</option>
                <option value="in_progress">Keyin: jarayonda</option>
                <option value="resolved">Keyin: hal qilindi</option>
                <option value="closed">Keyin: yopish</option>
              </select>
            ) : null}
            <button className="primary-button" type="button" disabled={busy || !body.trim()} onClick={() => void send()}>
              <Send size={15} /> {busy ? "Yuborilmoqda…" : internal ? "Eslatmani saqlash" : "Javob yuborish"}
            </button>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : <p className="muted support-closed">Murojaat yopilgan. Foydalanuvchi yangi murojaat yuborishi mumkin.</p>}
    </section>
  );
}

function AttachmentLink({ file }: { file: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { void attachmentUrl(file.path).then(setUrl); }, [file.path]);
  const image = (file.mime_type ?? "").startsWith("image/");
  if (!url) return <span className="support-file muted">…</span>;
  return (
    <a className="support-file" href={url} target="_blank" rel="noreferrer">
      {image ? <img src={url} alt="Ilova" /> : <span>PDF</span>}
    </a>
  );
}

/* -------------------------------------------------------------- context */

function ContextPanel({ context }: { context: TicketContext }) {
  return (
    <aside className="panel support-context">
      <h3>Foydalanuvchi</h3>
      {context.user ? (
        <dl>
          <dt>Ism</dt><dd>{context.user.full_name || "—"}</dd>
          <dt>Username</dt><dd>{context.user.username ? `@${context.user.username}` : "—"}</dd>
          <dt>Ro‘yxatdan o‘tgan</dt><dd>{new Date(context.user.joined_at).toLocaleDateString("uz-UZ")}</dd>
          <dt>Holat</dt><dd>{context.user.status}</dd>
        </dl>
      ) : <p className="muted">—</p>}

      <h3>Hisob</h3>
      <dl>
        <dt>Tarif</dt><dd>{context.plan ? `${context.plan.name} · ${new Date(context.plan.expires_at).toLocaleDateString("uz-UZ")} gacha` : "Yo‘q"}</dd>
        <dt>J Tanga</dt><dd>{context.wallet ? `${context.wallet.balance.toLocaleString("uz-UZ")} (band: ${context.wallet.reserved})` : "—"}</dd>
        <dt>Sahifalar</dt><dd>{context.pages ? `bepul ${context.pages.welcome} · sotib olingan ${context.pages.bought}` : "—"}</dd>
      </dl>

      {context.related_order ? (
        <>
          <h3>Murojaatdagi buyurtma</h3>
          <dl>
            <dt>Raqam</dt><dd>{context.related_order.order_number}</dd>
            <dt>Holat</dt><dd>{context.related_order.status}{context.related_order.failure_message ? ` — ${context.related_order.failure_message}` : ""}</dd>
            <dt>Summa</dt><dd>{context.related_order.total_amount.toLocaleString("uz-UZ")} so‘m</dd>
            <dt>Sana</dt><dd>{new Date(context.related_order.created_at).toLocaleString("uz-UZ")}</dd>
          </dl>
        </>
      ) : null}

      {context.related_presentation ? (
        <>
          <h3>Murojaatdagi taqdimot</h3>
          <dl>
            <dt>Nomi</dt><dd>{context.related_presentation.title}</dd>
            <dt>Holat</dt><dd>{context.related_presentation.status}{context.related_presentation.error_message ? ` — ${context.related_presentation.error_message}` : ""}</dd>
            <dt>Sahifalar</dt><dd>{context.related_presentation.slides}</dd>
          </dl>
        </>
      ) : null}

      <h3>Oxirgi buyurtmalar</h3>
      {context.orders.length ? (
        <ul className="support-orders">
          {context.orders.map((order) => (
            <li key={order.order_number}><strong>{order.order_number}</strong> · {order.purpose} · {order.status} · {order.total_amount.toLocaleString("uz-UZ")} so‘m</li>
          ))}
        </ul>
      ) : <p className="muted">Buyurtma yo‘q.</p>}

      <h3>Tarix</h3>
      <ul className="support-events">
        {context.events.map((event, index) => (
          <li key={index}><span className="muted">{new Date(event.created_at).toLocaleString("uz-UZ")}</span> {event.actor ?? "—"}: {eventLabel(event.kind, event.from, event.to)}</li>
        ))}
      </ul>
    </aside>
  );
}

function eventLabel(kind: string, from: string | null, to: string | null): string {
  const status = (value: string | null) => (value && value in STATUS_LABELS ? STATUS_LABELS[value as TicketStatus] : value ?? "—");
  switch (kind) {
    case "created": return "murojaat ochildi";
    case "status": return `holat: ${status(from)} → ${status(to)}`;
    case "priority": return `muhimlik: ${from ?? "—"} → ${to ?? "—"}`;
    case "assigned": return to ? "mas’ul biriktirildi" : "mas’ul olib tashlandi";
    case "reopened": return "qayta ochildi";
    case "replied": return "javob yozildi";
    case "note": return "ichki eslatma";
    default: return kind;
  }
}

/* ----------------------------------------------------------------- staff */

function StaffModal({ staff, onClose, onChanged }: { staff: StaffMember[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"support_agent" | "support_manager">("support_agent");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function apply(grant: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      await setSupportRole(email.trim(), role, grant);
      setMessage(grant ? "Rol berildi." : "Rol olib tashlandi.");
      await onChanged();
    } catch (failure) {
      setMessage(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Support xodimlari" description="Support xodimi faqat Yordam markazini ko‘radi; menejer murojaatlarni boshqa xodimlarga biriktira oladi." onClose={onClose}>
      <ul className="support-staff">
        {staff.map((member) => <li key={member.id}><strong>{member.full_name ?? member.id}</strong> <span className="muted">{member.role}</span></li>)}
      </ul>
      <div className="form-grid">
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="xodim@example.com" /></label>
        <label>Rol
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="support_agent">Support xodimi</option>
            <option value="support_manager">Support menejeri</option>
          </select>
        </label>
      </div>
      {message ? <p className="muted">{message}</p> : null}
      <div className="header-actions">
        <button className="secondary-button" type="button" disabled={busy || !email.trim()} onClick={() => void apply(false)}>Rolni olib tashlash</button>
        <button className="primary-button" type="button" disabled={busy || !email.trim()} onClick={() => void apply(true)}>Rol berish</button>
      </div>
    </Modal>
  );
}
