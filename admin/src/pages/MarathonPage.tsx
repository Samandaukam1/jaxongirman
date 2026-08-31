import { AlertTriangle, Image as ImageIcon, ShieldAlert, Trophy, Upload, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState, ErrorState, Modal, PageHeader, StatusBadge } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * The marathon, months before anybody can see it.
 *
 * §30 is what this page is for: a campaign can be written, illustrated, priced
 * and rehearsed while every switch is off and no user can tell the feature
 * exists. Nothing here reads the visibility flag to decide what an
 * administrator may edit — only launching does, and launching is one button
 * with one confirmation, because it changes five screens for everybody at once.
 *
 * The poster is the one piece of real design work in the console. It is cropped
 * to 2.35:1 here rather than validated and rejected: an administrator holding a
 * 16:9 export should not have to open an image editor to publish a campaign,
 * and a centre crop is exactly what the app would do at draw time anyway —
 * done once, visibly, with both previews on screen.
 */

const POSTER_RATIO = 2.35;

type Tier = { position: number; votes_required: number; premium_required: number; reward_percent: number };

type Campaign = {
  id: string;
  title: string;
  description: string;
  rules: string;
  poster_path: string | null;
  status: "draft" | "active" | "ended";
  starts_at: string;
  ends_at: string;
  contract_cap: number;
  min_free_price: number;
  min_premium_price: number;
  participants: number;
  votes: number;
  tiers: Tier[];
};

type Overview = { marathon_enabled: boolean; market_enabled: boolean; campaigns: Campaign[] };

/**
 * What a candidate's votes look like, in the four ways they can look wrong.
 *
 * Counts, never a verdict. A real campaign brings real sign-ups, so fresh
 * accounts are high for honest candidates too — the signals matter beside each
 * other, and the decision is a person's.
 */
type Signal = {
  candidate_id: string;
  username: string | null;
  full_name: string | null;
  total: number;
  premium: number;
  direct: number;
  bought: number;
  distinct_voters: number;
  fresh_voters: number;
  burst: number;
  top_seller_share: number;
};

/** What one seller is owed for votes that have already changed hands. */
type Payout = {
  seller_id: string;
  username: string | null;
  full_name: string | null;
  sales: number;
  votes: number;
  gross: number;
  fee: number;
  net: number;
};

const som = (value: number) => `${new Intl.NumberFormat("ru-RU").format(value)} so‘m`;

const DEFAULT_TIERS: Tier[] = [
  { position: 1, votes_required: 1000, premium_required: 300, reward_percent: 25 },
  { position: 2, votes_required: 2000, premium_required: 600, reward_percent: 50 },
  { position: 3, votes_required: 3000, premium_required: 900, reward_percent: 75 },
  { position: 4, votes_required: 4000, premium_required: 1200, reward_percent: 100 },
];

/** `2026-09-01T10:00` — what `datetime-local` wants, in local time. */
function toLocalInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A month from now, which is what §31's launch flow assumes a campaign is.
 *
 * Outside the component because the clock is not a render input: a lint rule
 * that objects to reading it during render is right to, and the answer is to
 * ask for it where the decision is made rather than to silence the rule.
 */
function defaultWindow(): { starts_at: string; ends_at: string } {
  const now = new Date();
  return {
    starts_at: now.toISOString(),
    ends_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
  };
}

function posterUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from("marathon-posters").getPublicUrl(path).data.publicUrl;
}

/**
 * Centre-crops an image to 2.35:1 and returns it as a JPEG.
 *
 * The crop is taken from the middle because a poster's subject is composed in
 * the middle; anything smarter would be guessing about artwork the console has
 * never seen. Re-encoded at 0.92, which is indistinguishable from the original
 * at poster size and keeps a 4 MB phone photograph from becoming a 4 MB asset
 * on a home screen.
 */
async function cropToRatio(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const wide = bitmap.width / bitmap.height > POSTER_RATIO;
  const width = wide ? Math.round(bitmap.height * POSTER_RATIO) : bitmap.width;
  const height = wide ? bitmap.height : Math.round(bitmap.width / POSTER_RATIO);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas mavjud emas");
  context.drawImage(bitmap, Math.round((bitmap.width - width) / 2), Math.round((bitmap.height - height) / 2),
    width, height, 0, 0, width, height);
  bitmap.close();
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("rasm tayyorlanmadi"))), "image/jpeg", 0.92);
  });
}

export function MarathonPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Campaign>>({});
  const [tiers, setTiers] = useState<Tier[]>(DEFAULT_TIERS);
  const [launching, setLaunching] = useState<Campaign | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: failure } = await supabase.rpc("admin_marathon_overview");
    if (failure) {
      setError(errorMessage(failure));
      setLoading(false);
      return;
    }
    const next = data as unknown as Overview | null;
    setOverview(next);
    setError(null);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The integrity half is read for whichever campaign is running: signals and
  // money are about a campaign in flight, not about a draft nobody has voted in.
  const running = overview?.campaigns.find((row) => row.status === "active") ?? null;
  useEffect(() => {
    if (!running) { setSignals([]); setPayouts([]); return; }
    let cancelled = false;
    void Promise.all([
      supabase.rpc("admin_marathon_fraud", { p_campaign_id: running.id }),
      supabase.rpc("admin_marathon_payouts", { p_campaign_id: running.id }),
    ]).then(([fraud, owed]) => {
      if (cancelled) return;
      setSignals((fraud.data as unknown as Signal[]) ?? []);
      setPayouts((owed.data as unknown as Payout[]) ?? []);
    });
    return () => { cancelled = true; };
  }, [running]);

  const campaign = overview?.campaigns.find((row) => row.id === selected) ?? null;

  function edit(row: Campaign | null) {
    setSelected(row?.id ?? null);
    setForm(row ?? {
      title: "",
      description: "",
      rules: "",
      contract_cap: 10_000_000,
      min_free_price: 5000,
      min_premium_price: 15000,
      ...defaultWindow(),
    });
    setTiers(row && row.tiers.length > 0 ? row.tiers : DEFAULT_TIERS);
    setMessage(null);
  }

  async function switchFlag(fn: "admin_set_student_marathon" | "admin_set_vote_marketplace", enabled: boolean) {
    setBusy(true);
    const { error: failure } = await supabase.rpc(fn, { p_enabled: enabled });
    if (failure) setError(errorMessage(failure));
    else { setError(null); await load(); }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const { data, error: failure } = await supabase.rpc("admin_save_marathon_campaign", {
      p_id: selected ?? undefined,
      p_title: form.title ?? "",
      p_description: form.description ?? undefined,
      p_rules: form.rules ?? undefined,
      p_starts_at: form.starts_at ?? undefined,
      p_ends_at: form.ends_at ?? undefined,
      p_contract_cap: form.contract_cap ?? undefined,
      p_min_free_price: form.min_free_price ?? undefined,
      p_min_premium_price: form.min_premium_price ?? undefined,
    });
    if (failure) {
      setError(errorMessage(failure));
      setBusy(false);
      return;
    }
    const saved = data as unknown as Campaign;
    // The ladder is only writable while the campaign is a draft; sending it for
    // a running one would raise, and the form does not offer it either.
    if (saved.status === "draft") {
      const tierResult = await supabase.rpc("admin_set_marathon_tiers", {
        p_campaign_id: saved.id,
        p_tiers: tiers,
      });
      if (tierResult.error) {
        setError(errorMessage(tierResult.error));
        setBusy(false);
        return;
      }
    }
    setError(null);
    setMessage("Saqlandi.");
    setSelected(saved.id);
    await load();
    setBusy(false);
  }

  async function uploadPoster(file: File) {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const cropped = await cropToRatio(file);
      const path = `${selected}/poster-${Date.now()}.jpg`;
      const uploaded = await supabase.storage.from("marathon-posters")
        .upload(path, cropped, { contentType: "image/jpeg", upsert: true });
      if (uploaded.error) throw uploaded.error;
      const saved = await supabase.rpc("admin_save_marathon_campaign", {
        p_id: selected,
        p_title: form.title ?? campaign?.title ?? "",
        p_poster_path: path,
      });
      if (saved.error) throw saved.error;
      setForm((current) => ({ ...current, poster_path: path }));
      setMessage("Afisha yuklandi va 2.35:1 ga kesildi.");
      await load();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function settle(seller: Payout) {
    setBusy(true);
    const { error: failure } = await supabase.rpc("admin_settle_marathon_sales", { p_seller_id: seller.seller_id });
    if (failure) setError(errorMessage(failure));
    else {
      setError(null);
      setMessage(`${som(seller.net)} to‘langan deb belgilandi.`);
      setPayouts((current) => current.filter((row) => row.seller_id !== seller.seller_id));
    }
    setBusy(false);
  }

  async function launch(row: Campaign) {
    setBusy(true);
    const { error: failure } = await supabase.rpc("admin_launch_marathon", { p_campaign_id: row.id });
    if (failure) setError(errorMessage(failure));
    else { setError(null); setMessage("Marafon ishga tushdi."); await load(); }
    setLaunching(null);
    setBusy(false);
  }

  async function end(row: Campaign) {
    setBusy(true);
    const { error: failure } = await supabase.rpc("admin_end_marathon", { p_campaign_id: row.id });
    if (failure) setError(errorMessage(failure));
    else { setError(null); setMessage("Marafon yakunlandi."); await load(); }
    setBusy(false);
  }

  const poster = posterUrl(form.poster_path ?? campaign?.poster_path ?? null);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Talabalar marafoni"
        title="Marafon boshqaruvi"
        description="Kampaniyani oldindan tayyorlang: afisha, qoidalar, sanalar va sovrinlar. Foydalanuvchilarga faqat ishga tushirilgandan keyin ko‘rinadi."
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {message ? <p className="jslayd-message">{message}</p> : null}

      <section className="panel">
        <h3>Ko‘rinish</h3>
        <p className="panel-hint">
          Marafon o‘chirilganda ilovada bitta ham marafon elementi ko‘rinmaydi: ovoz berish
          tugmalari, afisha, profil bo‘limi va bozor. Adminda esa hammasi tahrirlanaveradi.
        </p>
        <div className="form-grid">
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={busy || loading}
              checked={overview?.marathon_enabled ?? false}
              onChange={(event) => void switchFlag("admin_set_student_marathon", event.target.checked)}
            />
            Talabalar marafoni foydalanuvchilarga ko‘rinsin
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={busy || loading || !(overview?.marathon_enabled ?? false)}
              checked={overview?.market_enabled ?? false}
              onChange={(event) => void switchFlag("admin_set_vote_marketplace", event.target.checked)}
            />
            Ovozlar bozori ochiq bo‘lsin
          </label>
        </div>
      </section>

      <section className="panel">
        <h3>Kampaniyalar</h3>
        {loading ? (
          <p className="panel-hint">Yuklanmoqda…</p>
        ) : (overview?.campaigns.length ?? 0) === 0 ? (
          <EmptyState title="Kampaniya yo‘q" detail="Birinchi kampaniyani yarating — u ishga tushirilmaguncha hech kimga ko‘rinmaydi." />
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Nomi</th><th>Holat</th><th>Muddat</th><th>Ishtirokchi</th><th>Ovoz</th><th /></tr>
            </thead>
            <tbody>
              {overview?.campaigns.map((row) => (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td><StatusBadge value={row.status} /></td>
                  <td>{new Date(row.starts_at).toLocaleDateString()} — {new Date(row.ends_at).toLocaleDateString()}</td>
                  <td>{row.participants}</td>
                  <td>{row.votes}</td>
                  <td className="row-actions">
                    <button className="secondary-button" type="button" onClick={() => edit(row)}>Tahrirlash</button>
                    {row.status === "draft" ? (
                      <button className="primary-button" type="button" disabled={busy} onClick={() => setLaunching(row)}>
                        Ishga tushirish
                      </button>
                    ) : null}
                    {row.status === "active" ? (
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => void end(row)}>
                        Yakunlash
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="header-actions">
          <button className="primary-button" type="button" onClick={() => edit(null)}>Yangi kampaniya</button>
        </div>
      </section>

      {(selected !== null || form.title !== undefined) ? (
        <section className="panel">
          <h3>{selected ? "Kampaniyani tahrirlash" : "Yangi kampaniya"}</h3>
          <p className="panel-hint">
            Boshlangan kampaniyada faqat matn va afisha o‘zgaradi. Sana, kontrakt shifti va
            minimal narxlar — odamlar shularga qarab qatnashgan.
          </p>

          <div className="form-grid">
            <label className="wide">
              Kampaniya nomi
              <input value={form.title ?? ""} onChange={(event) => setForm((c) => ({ ...c, title: event.target.value }))} />
            </label>
            <label className="wide">
              Qisqa izoh
              <textarea rows={2} value={form.description ?? ""}
                onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))} />
            </label>
            <label className="wide">
              To‘liq qoidalar
              <textarea rows={6} value={form.rules ?? ""}
                onChange={(event) => setForm((c) => ({ ...c, rules: event.target.value }))} />
            </label>
            <label>
              Boshlanish
              <input type="datetime-local" disabled={campaign?.status !== undefined && campaign.status !== "draft"}
                value={toLocalInput(form.starts_at ?? "")}
                onChange={(event) => setForm((c) => ({ ...c, starts_at: new Date(event.target.value).toISOString() }))} />
            </label>
            <label>
              Tugash
              <input type="datetime-local" disabled={campaign?.status !== undefined && campaign.status !== "draft"}
                value={toLocalInput(form.ends_at ?? "")}
                onChange={(event) => setForm((c) => ({ ...c, ends_at: new Date(event.target.value).toISOString() }))} />
            </label>
            <label>
              Kontrakt shifti (so‘m)
              <input type="number" min={1} step={100000} disabled={campaign?.status !== undefined && campaign.status !== "draft"}
                value={form.contract_cap ?? 10000000}
                onChange={(event) => setForm((c) => ({ ...c, contract_cap: Number(event.target.value) }))} />
            </label>
            <label>
              Bepul ovoz minimal narxi
              <input type="number" min={1} step={1000} disabled={campaign?.status !== undefined && campaign.status !== "draft"}
                value={form.min_free_price ?? 5000}
                onChange={(event) => setForm((c) => ({ ...c, min_free_price: Number(event.target.value) }))} />
            </label>
            <label>
              Premium ovoz minimal narxi
              <input type="number" min={1} step={1000} disabled={campaign?.status !== undefined && campaign.status !== "draft"}
                value={form.min_premium_price ?? 15000}
                onChange={(event) => setForm((c) => ({ ...c, min_premium_price: Number(event.target.value) }))} />
            </label>
          </div>

          {campaign?.status === "draft" || !selected ? (
            <>
              <h4>Sovrinlar</h4>
              <table className="data-table">
                <thead><tr><th>Marra</th><th>Jami ovoz</th><th>Premium</th><th>Mukofot %</th></tr></thead>
                <tbody>
                  {tiers.map((tier, index) => (
                    <tr key={tier.position}>
                      <td>{tier.position}</td>
                      {(["votes_required", "premium_required", "reward_percent"] as const).map((field) => (
                        <td key={field}>
                          <input
                            type="number"
                            min={field === "reward_percent" ? 1 : 0}
                            max={field === "reward_percent" ? 100 : undefined}
                            value={tier[field]}
                            onChange={(event) => setTiers((current) => current.map((row, position) =>
                              position === index ? { ...row, [field]: Number(event.target.value) } : row))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          <h4>Afisha (2.35:1)</h4>
          {selected ? (
            <>
              <p className="panel-hint">
                Har qanday o‘lchamdagi rasm yuklanadi va markazidan 2.35:1 ga kesiladi —
                pastda aynan shu ko‘rinadi.
              </p>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadPoster(file);
                  event.target.value = "";
                }}
              />
              <button className="secondary-button" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
                <Upload size={16} strokeWidth={1.9} /> Afisha yuklash
              </button>

              <div className="marathon-previews">
                <figure>
                  <figcaption>Desktop</figcaption>
                  <div className="marathon-poster-frame desktop">
                    {poster ? <img src={poster} alt="Afisha" /> : <span className="marathon-poster-empty"><ImageIcon size={18} /> Afisha yo‘q</span>}
                  </div>
                </figure>
                <figure>
                  <figcaption>Mobil</figcaption>
                  <div className="marathon-poster-frame mobile">
                    {poster ? <img src={poster} alt="Afisha" /> : <span className="marathon-poster-empty"><ImageIcon size={18} /> Afisha yo‘q</span>}
                  </div>
                </figure>
              </div>
            </>
          ) : (
            <p className="panel-hint">Afisha yuklash uchun avval kampaniyani saqlang.</p>
          )}

          <div className="header-actions">
            <button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>Saqlash</button>
            <button className="secondary-button" type="button" onClick={() => { setSelected(null); setForm({}); }}>Yopish</button>
          </div>
        </section>
      ) : null}

      {running && signals.length > 0 ? (
        <section className="panel">
          <h3><ShieldAlert size={16} strokeWidth={1.9} /> Shubhali faoliyat</h3>
          <p className="panel-hint">
            Bular hukm emas, o‘lchov. Haqiqiy kampaniya ham yangi ro‘yxatdan o‘tganlarni
            olib keladi — raqamlar bir-birining yonida ma’noga ega bo‘ladi. Hech kim
            avtomatik bloklanmaydi.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Ishtirokchi</th><th>Jami</th><th>To‘g‘ridan</th><th>Sotib olingan</th>
                <th>Yangi akkount</th><th>10 daqiqadagi eng ko‘p</th><th>Bir sotuvchidan</th>
              </tr>
            </thead>
            <tbody>
              {signals.slice(0, 25).map((row) => (
                <tr key={row.candidate_id}>
                  <td>{row.full_name ?? "—"}{row.username ? ` (@${row.username})` : ""}</td>
                  <td>{row.total}</td>
                  <td>{row.direct}</td>
                  <td>{row.bought}</td>
                  <td>{row.fresh_voters}</td>
                  <td>{row.burst}</td>
                  <td>{row.bought > 0 ? `${row.top_seller_share}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {payouts.length > 0 ? (
        <section className="panel">
          <h3><Wallet size={16} strokeWidth={1.9} /> To‘lanmagan savdolar</h3>
          <p className="panel-hint">
            Ovozlari sotilgan va puli hali chiqarilmagan foydalanuvchilar. Summa savdo
            paytida yozilgan — komissiya keyin o‘zgarsa ham bu raqam o‘zgarmaydi.
          </p>
          <table className="data-table">
            <thead>
              <tr><th>Sotuvchi</th><th>Savdo</th><th>Ovoz</th><th>Jami</th><th>Komissiya</th><th>To‘lanadi</th><th /></tr>
            </thead>
            <tbody>
              {payouts.map((row) => (
                <tr key={row.seller_id}>
                  <td>{row.full_name ?? "—"}{row.username ? ` (@${row.username})` : ""}</td>
                  <td>{row.sales}</td>
                  <td>{row.votes}</td>
                  <td>{som(row.gross)}</td>
                  <td>{som(row.fee)}</td>
                  <td><strong>{som(row.net)}</strong></td>
                  <td className="row-actions">
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => void settle(row)}>
                      To‘landi
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {launching ? (
        <Modal
          title="Marafonni ishga tushirish"
          description="Marafon foydalanuvchilarga ko‘rinadi. Ovoz berish tugmalari va marafon bo‘limlari faollashadi."
          onClose={() => setLaunching(null)}
        >
          <div className="marathon-launch">
            <p><Trophy size={16} strokeWidth={1.9} /> <strong>{launching.title}</strong></p>
            <p className="panel-hint">
              {new Date(launching.starts_at).toLocaleString()} — {new Date(launching.ends_at).toLocaleString()}
            </p>
            {!launching.poster_path ? (
              <p className="qrv-warning"><AlertTriangle size={14} /> Afisha yuklanmagan — ishga tushirib bo‘lmaydi.</p>
            ) : null}
            <div className="header-actions">
              <button className="secondary-button" type="button" onClick={() => setLaunching(null)}>Bekor qilish</button>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void launch(launching)}>
                Ishga tushirish
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
