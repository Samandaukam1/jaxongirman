import {
  BadgeCheck,
  MonitorPlay, Blocks, ClipboardList, Coins, Cpu, Gamepad2, Gift, LayoutDashboard, LogOut, Menu, Palette, Presentation, Receipt, ScrollText, Smartphone, Store, TrendingUp, Users, Wallet, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AppLink } from "@/lib/router";
import { useAuth } from "@/providers/AuthProvider";

const navigation = [
  { to: "/", label: "Boshqaruv", icon: LayoutDashboard, end: true },
  { to: "/users", label: "Foydalanuvchilar", icon: Users },
  { to: "/presentations", label: "Prezentatsiyalar", icon: Presentation },
  { to: "/jslayd", label: "JSLAYD dizaynlar", icon: Palette },
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
  { to: "/gifts", label: "Sovg‘alar", icon: Gift },
  { to: "/audit", label: "Audit jurnali", icon: ScrollText },
  { to: "/finance", label: "Kirim-chiqim", icon: Wallet },
] as const;

export function AdminLayout({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { session, signOut } = useAuth();
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
