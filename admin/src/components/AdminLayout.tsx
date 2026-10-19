import {
  Sparkles,
  BadgeCheck,
  AppWindow, Landmark, Languages, LifeBuoy, Megaphone, Monitor, Moon, MonitorPlay, Blocks, ClipboardList, FileStack, Coins, Cpu, Gamepad2, Gift, Image as ImageIcon, LayoutDashboard, LogOut, Menu, Palette, Presentation, Receipt, ScrollText, Shapes, Smartphone, Store, Sun, TrendingUp, Trophy, Type, Users, Wallet, X } from "lucide-react";
import { ROLE_LABELS } from "@jaxongirman/types";
import { useEffect, useState, type ReactNode } from "react";

import { AppLink } from "@/lib/router";
import { supportUnreadCount } from "@/lib/support";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/providers/ThemeProvider";

const navigation = [
  { to: "/", label: "Boshqaruv", icon: LayoutDashboard, end: true },
  { to: "/tavsiyalar", label: "Tavsiya va reklama", icon: Megaphone },
  { to: "/users", label: "Foydalanuvchilar", icon: Users },
  { to: "/presentations", label: "Prezentatsiyalar", icon: Presentation },
  { to: "/dizayn-engine", label: "Liquid Glass dizayn", icon: Sparkles },
  { to: "/usage", label: "AI xarajatlari", icon: Cpu },
  { to: "/pricing", label: "Kredit va narxlar", icon: Coins },
  { to: "/tariflar", label: "Tariflar", icon: BadgeCheck },
  { to: "/iqtisod", label: "J Tanga iqtisodiyoti", icon: Landmark },
  { to: "/tillar", label: "Tillar va tarjimalar", icon: Languages },
  { to: "/support", label: "Support", icon: LifeBuoy },
  { to: "/modules", label: "Modullar va tangalar", icon: Blocks },
  { to: "/surveys", label: "So‘rovnomalar", icon: ClipboardList },
  { to: "/games", label: "O‘yingoh", icon: Gamepad2 },
  { to: "/marafon", label: "Talabalar marafoni", icon: Trophy },
  { to: "/marketplace", label: "Do‘kon", icon: Store },
  { to: "/marketplace-finance", label: "Do‘kon moliyasi", icon: TrendingUp },
  { to: "/orders", label: "Buyurtmalar", icon: Receipt },
  { to: "/app-store", label: "iOS to‘lov siyosati", icon: Smartphone },
  { to: "/fonts", label: "Shriftlar", icon: Type },
  { to: "/rasmlar", label: "Rasmlar", icon: ImageIcon },
  { to: "/qr-video", label: "QR Video Experience", icon: MonitorPlay },
  { to: "/sayt-ikonkalari", label: "Sayt ikonkalari", icon: AppWindow },
  { to: "/gifts", label: "Sovg‘alar", icon: Gift },
  { to: "/audit", label: "Audit jurnali", icon: ScrollText },
  { to: "/finance", label: "Kirim-chiqim", icon: Wallet },
] as const;

/**
 * The retired design tools, kept at the bottom under their own heading.
 *
 * No generation uses them any more — every deck's design is invented by the
 * Liquid Glass engine — but the catalogues still hold work somebody made, so
 * they stay reachable for reference rather than being deleted. Below
 * everything else, and labelled as the archive they are.
 */
const archive = [
  { to: "/jslayd", label: "JSLAYD dizaynlar", icon: Palette },
  { to: "/pptx", label: "PPTX shablonlar", icon: FileStack },
  { to: "/jelements", label: "JElement kutubxonasi", icon: Shapes },
] as const;

export function AdminLayout({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { session, signOut, role, isAdmin, isSupport } = useAuth();
  // The support desk's own staff see only their page.
  const items = isAdmin ? navigation : navigation.filter((item) => item.to === "/support");
  const [supportUnread, setSupportUnread] = useState(0);

  // Unanswered tickets, kept current while the console is open.
  useEffect(() => {
    if (!isSupport) return;
    let active = true;
    const read = () => void supportUnreadCount().then((count) => { if (active) setSupportUnread(count); });
    read();
    const timer = window.setInterval(read, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [isSupport]);
  const { mode, setMode } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="admin-shell">
      <button className="mobile-menu" type="button" aria-label="Menyuni ochish" onClick={() => setOpen(true)}>
        <Menu size={22} />
      </button>
      {open && <button className="sidebar-scrim" type="button" aria-label="Menyuni yopish" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">J</span>
          <div><strong>Jaxongirman</strong><small>Control Center</small></div>
          <button className="sidebar-close" type="button" aria-label="Yopish" onClick={() => setOpen(false)}><X size={20} /></button>
        </div>
        <nav className="sidebar-nav" aria-label="Asosiy navigatsiya">
          {items.map(({ to, label, icon: Icon }) => (
            <AppLink key={to} to={to} className={pathname === to ? "active" : undefined} onClick={() => setOpen(false)}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
              {to === "/support" && supportUnread > 0 ? <em className="nav-badge">{supportUnread}</em> : null}
            </AppLink>
          ))}
          {isAdmin ? <div className="sidebar-section" role="separator">Arxiv — ishlatilmaydi</div> : null}
          {(isAdmin ? archive : []).map(({ to, label, icon: Icon }) => (
            <AppLink key={to} to={to} className={`sidebar-archived${pathname === to ? " active" : ""}`} onClick={() => setOpen(false)}>
              <Icon size={17} strokeWidth={1.6} /><span>{label}</span>
            </AppLink>
          ))}
        </nav>
        {/* Above the account, because it is a preference about the window
            rather than about who is signed in. */}
        <div className="theme-switch" role="group" aria-label="Ko‘rinish">
          {([
            { key: "system", label: "Tizim", Glyph: Monitor },
            { key: "light", label: "Yorug‘", Glyph: Sun },
            { key: "dark", label: "Qorong‘i", Glyph: Moon },
          ] as const).map((option) => (
            <button
              key={option.key}
              className={mode === option.key ? "on" : undefined}
              type="button"
              title={option.label}
              aria-pressed={mode === option.key}
              onClick={() => setMode(option.key)}
            >
              <option.Glyph size={15} />
            </button>
          ))}
        </div>
        <div className="sidebar-account">
          <div className="account-avatar">{session?.user.email?.[0]?.toUpperCase() ?? "A"}</div>
          <div className="account-copy"><strong>{ROLE_LABELS[role] ?? "Administrator"}</strong><span>{session?.user.email}</span></div>
          <button className="icon-button inverse" type="button" title="Chiqish" onClick={() => void signOut()}><LogOut size={18} /></button>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
