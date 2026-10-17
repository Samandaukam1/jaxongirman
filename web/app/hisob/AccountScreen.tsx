"use client";

import { useCallback, useEffect, useState } from "react";

import {
  confirmDevice, deviceAlerts, deviceLabel, listDevices, registerBrowser, revokeDevice, revokeOthers, when,
  type DeviceAlert, type DeviceRow,
} from "@/lib/devices";
import { supabase } from "@/lib/supabase";

type Account = { name: string; email: string | null; username: string | null; balance: number | null };

/**
 * The account, on the website, once the phone has let this browser in.
 *
 * What it shows is read under the same row security as the app — the person's
 * own profile and wallet — and the same device list, under the same rule: a
 * device that signed in after this browser can be taken out at once, an
 * earlier one only after this browser has been signed in for two hours.
 * Signing out ends only this browser's session.
 */
export function AccountScreen() {
  const [account, setAccount] = useState<Account | null>(null);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [alerts, setAlerts] = useState<DeviceAlert[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const loadDevices = useCallback(async () => {
    const [rows, open] = await Promise.all([listDevices().catch(() => []), deviceAlerts()]);
    setDevices(rows);
    setAlerts(open);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.replace("/kirish"); return; }
      // Taken out from another device: leave at once.
      if (!(await registerBrowser())) {
        await supabase.auth.signOut({ scope: "local" });
        window.location.replace("/kirish");
        return;
      }
      const [profile, wallet] = await Promise.all([
        supabase.from("profiles").select("full_name, first_name, last_name, username").eq("id", session.user.id).maybeSingle(),
        supabase.from("credit_wallets").select("balance").eq("user_id", session.user.id).maybeSingle(),
      ]);
      if (!alive) return;
      const row = profile.data;
      const name = row?.full_name?.trim() || [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim() || session.user.email || "Jaxongirman";
      setAccount({ name, email: session.user.email ?? null, username: row?.username ?? null, balance: wallet.data?.balance ?? null });
      await loadDevices();
    })();
    // A browser left open still learns when it was taken out.
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void registerBrowser().then(async (active) => {
        if (active) return;
        await supabase.auth.signOut({ scope: "local" });
        window.location.replace("/kirish");
      });
    };
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 60_000);
    return () => { alive = false; document.removeEventListener("visibilitychange", check); clearInterval(timer); };
  }, [loadDevices]);

  async function remove(row: { session_id: string }, label: string) {
    if (!window.confirm(`${label} chiqarilsinmi? Bu qurilmada hisobingizdan chiqiladi.`)) return;
    setBusy(row.session_id);
    const refused = await revokeDevice(row.session_id);
    setBusy(null);
    setNotice(refused ?? `${label} chiqarildi.`);
    await loadDevices();
  }

  async function removeOthers() {
    if (!window.confirm("Shu brauzerdan boshqa hamma joyda hisobingizdan chiqilsinmi?")) return;
    setBusy("others");
    const result = await revokeOthers();
    setBusy(null);
    setNotice(typeof result === "string" ? result
      : result.kept > 0 && result.revoke_from
        ? `Chiqarilgan qurilmalar: ${result.revoked}. Qolganlarini ${when(result.revoke_from)} dan keyin chiqarish mumkin.`
        : `Chiqarilgan qurilmalar: ${result.revoked}.`);
    await loadDevices();
  }

  async function keep(alert: DeviceAlert) {
    setBusy(alert.session_id);
    await confirmDevice(alert.session_id);
    setBusy(null);
    await loadDevices();
  }

  async function signOut() {
    setLeaving(true);
    // This browser only: the phone keeps its own session.
    await supabase.auth.signOut({ scope: "local" });
    window.location.replace("/");
  }

  if (!account) {
    return (
      <main className="account-page">
        <div className="signin-progress"><span className="presentation-spinner" /></div>
      </main>
    );
  }

  const others = devices?.filter((row) => !row.is_current) ?? [];

  return (
    <main className="account-page">
      <div className="shell account-shell">
        <p className="eyebrow">HISOBIM</p>

        {alerts.map((alert) => {
          const label = deviceLabel({ name: alert.name, platform: alert.platform });
          return (
            <section className="device-alert" key={alert.session_id}>
              <div>
                <h2>Yangi qurilmadan kirildi</h2>
                <p>{label} · {when(alert.signed_in_at)}. Bu sizmisiz?</p>
              </div>
              <div className="device-alert-actions">
                <button type="button" className="account-signout" disabled={busy !== null} onClick={() => void keep(alert)}>Ha, bu men</button>
                {alert.can_revoke ? (
                  <button type="button" className="device-revoke" disabled={busy !== null} onClick={() => void remove(alert, label)}>Yo&lsquo;q, chiqarish</button>
                ) : null}
              </div>
            </section>
          );
        })}

        <section className="account-card">
          <div className="account-avatar" aria-hidden>{account.name.trim().charAt(0).toUpperCase()}</div>
          <div className="account-who">
            <h1>{account.name}</h1>
            <p>{[account.username ? `@${account.username}` : null, account.email].filter(Boolean).join(" · ")}</p>
          </div>
          {account.balance !== null ? (
            <div className="account-balance">
              <span>J Tanga</span>
              <strong>{account.balance.toLocaleString("uz-UZ")}</strong>
            </div>
          ) : null}
        </section>

        <div className="account-actions">
          <a className="store-button" href="/taqdimot">Taqdimot qilish</a>
          <a className="store-button ghost" href="/dokon">Do&lsquo;kon</a>
          <a className="store-button ghost" href="/tarif">Tariflar</a>
        </div>

        <section className="device-list">
          <h2>Qurilmalar</h2>
          {notice ? <p className="device-notice">{notice}</p> : null}
          {devices === null ? <span className="presentation-spinner" /> : devices.map((row) => {
            const label = deviceLabel(row);
            return (
              <div className="device-row" key={row.session_id}>
                <div>
                  <strong>{label}</strong>
                  {row.is_current ? <em>Shu brauzer</em> : !row.confirmed ? <em className="is-new">Yangi</em> : null}
                  <span>Kirgan: {when(row.signed_in_at)}</span>
                  {!row.is_current && !row.can_revoke && row.revoke_from ? <span>{when(row.revoke_from)} dan keyin chiqarish mumkin</span> : null}
                </div>
                {!row.is_current && row.can_revoke ? (
                  <button type="button" className="device-revoke" disabled={busy !== null} onClick={() => void remove(row, label)}>
                    {busy === row.session_id ? "…" : "Chiqarish"}
                  </button>
                ) : null}
              </div>
            );
          })}
          {others.some((row) => row.can_revoke) ? (
            <button type="button" className="device-revoke wide" disabled={busy !== null} onClick={() => void removeOthers()}>
              Boshqa barcha qurilmalardan chiqish
            </button>
          ) : null}
          <p className="account-note">
            Xavfsizlik uchun yangi kirilgan qurilma avvalgi qurilmalarni faqat 2 soatdan keyin chiqara oladi. Avvalgi qurilma yangisini darhol chiqara oladi.
          </p>
        </section>

        <button className="account-signout" type="button" onClick={() => void signOut()} disabled={leaving}>
          {leaving ? "Chiqilmoqda…" : "Bu brauzerdan chiqish"}
        </button>
      </div>
    </main>
  );
}
