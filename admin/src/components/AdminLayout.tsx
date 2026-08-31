import {
  Sparkles,
  BadgeCheck,
  Monitor, Moon, MonitorPlay, Blocks, ClipboardList, FileStack, Coins, Cpu, Gamepad2, Gift, Image as ImageIcon, LayoutDashboard, LogOut, Menu, Palette, Presentation, Receipt, ScrollText, Shapes, Smartphone, Store, Sun, TrendingUp, Type, Users, Wallet, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AppLink } from "@/lib/router";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/providers/ThemeProvider";

const navigation = [
  { to: "/", label: "Boshqaruv", icon: LayoutDashboard, end: true },
  { to: "/users", label: "Foydalanuvchilar", icon: Users },
  { to: "/presentations", label: "Prezentatsiyalar", icon: Presentation },
  { to: "/jslayd", label: "JSLAYD dizaynlar", icon: Palette },
  { to: "/pptx", label: "PPTX shablonlar", icon: FileStack },
  { to: "/jelements", label: "JElement kutubxonasi", icon: Shapes },
  { to: "/qr-video", label: "QR Video Experience", icon: MonitorPlay },
  { to: "/usage", label: "AI xarajatlari", icon: Cpu },
  { to: "/pricing", label: "Kredit va narxlar", icon: Coins },
  { to: "/tariflar", label: "Tariflar", icon: BadgeCheck },
  { to: "/modules", label: "Modullar va tangalar", icon: Blocks },
  { to: "/surveys", label: "So‘rovnomalar", icon: ClipboardList },
  { to: "/games", label: "O‘yingoh", icon: Gamepad2 },
  { to: "/marketplace", label: "Do‘kon", icon: Store },
  { to: "/marketplace-finance", label: "Do‘kon moliyasi", icon: TrendingUp },
  { to: "/orders", label: "Buyurtmalar", icon: Receipt },
  { to: "/app-store", label: "iOS to‘lov siyosati", icon: Smartphone },
  { to: "/fonts", label: "Shriftlar", icon: Type },
  { to: "/rasmlar", label: "Rasmlar", icon: ImageIcon },
  { to: "/dizayn-engine", label: "Dizayn engine", icon: Sparkles },
  { to: "/gifts", label: "Sovg‘alar", icon: Gift },
  { to: "/audit", label: "Audit jurnali", icon: ScrollText },
  { to: "/finance", label: "Kirim-chiqim", icon: Wallet },
] as const;

export function AdminLayout({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { session, signOut } = useAuth();
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
          {navigation.map(({ to, label, icon: Icon }) => (
            <AppLink key={to} to={to} className={pathname === to ? "active" : undefined} onClick={() => setOpen(false)}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
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
          <div className="account-copy"><strong>Administrator</strong><span>{session?.user.email}</span></div>
          <button className="icon-button inverse" type="button" title="Chiqish" onClick={() => void signOut()}><LogOut size={18} /></button>
        </div>
      </aside>
      <main className="admin-main">{children}</main>
    </div>
  );
}
