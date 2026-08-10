import type { ReactNode } from "react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

export function StatusBadge({ value }: { value: string }) {
  return <span className={`status-badge status-${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="inline-state error-state"><AlertCircle size={22} /><div><strong>Ma’lumot yuklanmadi</strong><p>{message}</p></div>{onRetry && <button className="text-button" type="button" onClick={onRetry}><RefreshCw size={15} /> Qayta urinish</button>}</div>;
}

export function EmptyState({ title = "Ma’lumot topilmadi", detail }: { title?: string; detail: string }) {
  return <div className="empty-state"><Inbox size={30} /><strong>{title}</strong><span>{detail}</span></div>;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="table-skeleton">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>;
}

export function Modal({ title, description, children, onClose }: { title: string; description: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" aria-label="Yopish" onClick={onClose}>×</button><p className="eyebrow">XAVFSIZ AMAL</p><h2>{title}</h2><p className="muted">{description}</p>{children}</section></div>;
}
