import type { ReactNode } from "react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

export function StatusBadge({ value }: { value: string }) {
  return <span className={`status-badge status-${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

/**
 * `title` defaults to a loading failure because that is what most callers are
 * reporting — but not all of them. A prompt that will not compile announced
 * itself as "data did not load", which is a sentence about the wrong thing and
 * sends the reader looking for a network problem that is not there.
 */
export function ErrorState({ title = "Ma’lumot yuklanmadi", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return <div className="inline-state error-state"><AlertCircle size={22} /><div><strong>{title}</strong><p>{message}</p></div>{onRetry && <button className="text-button" type="button" onClick={onRetry}><RefreshCw size={15} /> Qayta urinish</button>}</div>;
}

export function EmptyState({ title = "Ma’lumot topilmadi", detail }: { title?: string; detail: string }) {
  return <div className="empty-state"><Inbox size={30} /><strong>{title}</strong><span>{detail}</span></div>;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="table-skeleton">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>;
}

/**
 * A dialog that is never taller than the screen.
 *
 * It used to grow to whatever its contents needed while the backdrop centred
 * it, so a long one — the JElement import, once it was reporting on thirteen
 * elements — hung off the top and the bottom of the viewport at once, with no
 * scroll container anywhere. The heading was unreachable above and the submit
 * button unreachable below, which is a dialog you can read but not use.
 *
 * So the card caps itself at the viewport and the body scrolls inside it. The
 * title and the close button stay put, because they are how somebody works out
 * where they are and how they get out.
 */
export function Modal({ title, description, children, onClose }: { title: string; description: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="Yopish" onClick={onClose}>×</button><header className="modal-head"><p className="eyebrow">XAVFSIZ AMAL</p><h2>{title}</h2><p className="muted">{description}</p></header><div className="modal-body">{children}</div></section></div>;
}
