import type { Database } from "@jaxongirman/types";
import {
  Activity, Ban, Coins, Eye, EyeOff, Gamepad2, Search, Sparkles, Star, StarOff, Users,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, ErrorState, Modal, PageHeader, StatusBadge, TableSkeleton } from "@/components/AdminUI";
import { errorMessage, stamp } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type GameRow = Database["public"]["Functions"]["admin_list_games"]["Returns"][number];
type SessionRow = Database["public"]["Functions"]["admin_list_game_sessions"]["Returns"][number];
type CategoryRow = Database["public"]["Tables"]["game_categories"]["Row"];

type Overview = {
  today: {
    games_created: number; sessions_finished: number; participants: number;
    answers: number; rewards_paid: number; game_sales: number;
  };
  window: {
    days: number; games_created: number; sessions_finished: number; participants: number;
    answers: number; rewards_paid: number; game_sales: number; ai_cost_usd: number;
  };
  live_sessions: number;
};

const WINDOWS = [
  { days: 1, label: "Bugun" },
  { days: 7, label: "7 kun" },
  { days: 30, label: "30 kun" },
] as const;

const SESSION_LABELS: Record<string, string> = {
  lobby: "Lobbi",
  countdown: "Sanoq",
  question: "Savol",
  question_result: "Natija",
  leaderboard: "Jadval",
  finished: "Yakunlandi",
  cancelled: "Bekor qilindi",
  expired: "Muddati tugadi",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Qo‘lda",
  ai: "AI",
  text: "Matndan",
  file: "Fayldan",
  presentation: "Prezentatsiyadan",
};

function number(value: number): string {
  return value.toLocaleString("uz-UZ");
}

/**
 * O‘yingoh operations.
 *
 * Three things live here that live nowhere else: the curation switches (free,
 * featured) that decide what appears on every user's home screen, the subject
 * tree the module browses, and the ability to stop a match that is running in
 * front of a room. All three write an audit record, and terminating a live
 * session additionally refunds the host's reward hold — the coins never sit in
 * limbo because an administrator intervened.
 */
export function GamesPage() {
  const [days, setDays] = useState<number>(7);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [liveOnly, setLiveOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [terminating, setTerminating] = useState<SessionRow | null>(null);
  const [reason, setReason] = useState("");
  const [editingCategory, setEditingCategory] = useState<CategoryRow | "new" | null>(null);
  const [categoryForm, setCategoryForm] = useState({ code: "", label: "", icon: "", sort_order: 0, is_active: true });
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [overviewResult, gamesResult, sessionsResult, categoriesResult] = await Promise.all([
      supabase.rpc("admin_game_overview", { p_days: days }),
      supabase.rpc("admin_list_games", { p_search: search || undefined, p_limit: 100, p_offset: 0 }),
      supabase.rpc("admin_list_game_sessions", { p_live_only: liveOnly }),
      supabase.from("game_categories").select("*").order("sort_order"),
    ]);
    const failure = overviewResult.error ?? gamesResult.error ?? sessionsResult.error ?? categoriesResult.error;
    if (failure) {
      setError(errorMessage(failure));
    } else {
      setOverview(overviewResult.data as unknown as Overview);
      setGames(gamesResult.data ?? []);
      setSessions(sessionsResult.data ?? []);
      setCategories(categoriesResult.data ?? []);
    }
    setLoading(false);
  }, [days, liveOnly, search]);

  useEffect(() => { void load(); }, [load]);

  async function moderate(game: GameRow, action: "hide" | "restore" | "set_free" | "unset_free" | "feature" | "unfeature") {
    setBusy(game.id);
    setError(null);
    const { error: failure } = await supabase.rpc("admin_moderate_game", {
      p_game_id: game.id, p_action: action, p_reason: "",
    });
    if (failure) setError(errorMessage(failure));
    else { setMessage(`“${game.title || "Nomsiz o‘yin"}” yangilandi.`); await load(); }
    setBusy(null);
  }

  async function terminate(event: FormEvent) {
    event.preventDefault();
    if (!terminating) return;
    if (reason.trim() === "") {
      setModalError("To‘xtatish sababini yozing — u audit jurnaliga yoziladi.");
      return;
    }
    setBusy(terminating.id);
    setModalError(null);
    const { error: failure } = await supabase.rpc("admin_terminate_game_session", {
      p_session_id: terminating.id, p_reason: reason.trim(),
    });
    if (failure) setModalError(errorMessage(failure));
    else {
      setMessage("O‘yin to‘xtatildi va mukofot jamg‘armasi boshlovchiga qaytarildi.");
      setTerminating(null);
      setReason("");
      await load();
    }
    setBusy(null);
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    if (!editingCategory) return;
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(categoryForm.code)) {
      setModalError("Kod lotin harflari, raqam va pastki chiziqdan iborat bo‘lishi kerak.");
      return;
    }
    if (categoryForm.label.trim() === "") {
      setModalError("Nomni yozing.");
      return;
    }
    setModalError(null);
    const { error: failure } = await supabase.rpc("admin_save_game_category", {
      // Creating omits p_id entirely; editing names the row.
      ...(editingCategory === "new" ? {} : { p_id: editingCategory.id }),
      p_code: categoryForm.code,
      p_label: categoryForm.label.trim(),
      p_icon: categoryForm.icon.trim(),
      p_sort_order: categoryForm.sort_order,
      p_is_active: categoryForm.is_active,
    });
    if (failure) setModalError(errorMessage(failure));
    else { setMessage("Kategoriya saqlandi."); setEditingCategory(null); await load(); }
  }

  async function deleteCategory(category: CategoryRow) {
    setBusy(category.id);
    const { error: failure } = await supabase.rpc("admin_delete_game_category", { p_id: category.id });
    if (failure) setError(errorMessage(failure));
    else { setMessage(`“${category.label}” o‘chirildi.`); await load(); }
    setBusy(null);
  }

  const cards = useMemo(() => overview ? [
    { label: "Yaratilgan o‘yinlar", value: number(overview.window.games_created), note: `Bugun: ${number(overview.today.games_created)}`, icon: Gamepad2 },
    { label: "O‘tkazilgan o‘yinlar", value: number(overview.window.sessions_finished), note: `Bugun: ${number(overview.today.sessions_finished)}`, icon: Activity },
    { label: "Ishtirokchilar", value: number(overview.window.participants), note: `${number(overview.window.answers)} javob`, icon: Users },
    { label: "J mukofot", value: number(overview.window.rewards_paid), note: `Bugun: ${number(overview.today.rewards_paid)} J`, icon: Coins },
    { label: "AI xarajati", value: `$${overview.window.ai_cost_usd.toFixed(4)}`, note: `${number(overview.window.game_sales)} do‘kon savdosi`, icon: Sparkles },
  ] : [], [overview]);

  return <div className="page-stack">
    <PageHeader
      eyebrow="O‘YINGOH"
      title="O‘yingoh boshqaruvi"
      description="Bepul va tanlangan o‘yinlar shu yerdan belgilanadi, jonli o‘yinlar kuzatiladi. Har bir amal audit jurnaliga yoziladi."
      action={<button className="secondary-button compact" type="button" onClick={() => void load()}>Yangilash</button>}
    />

    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {message && <div className="success-banner">{message}</div>}

    <div className="toolbar">
      {WINDOWS.map((option) => (
        <button
          key={option.days}
          className={`secondary-button compact ${days === option.days ? "is-active" : ""}`}
          type="button"
          onClick={() => setDays(option.days)}
        >
          {option.label}
        </button>
      ))}
      {overview && overview.live_sessions > 0 ? (
        <span className="live-pill"><Activity size={14} /> {overview.live_sessions} jonli o‘yin</span>
      ) : null}
    </div>

    <section className="metric-grid">
      {cards.map(({ label, value, note, icon: Icon }) => (
        <article className="metric-card" key={label}>
          <div className="metric-icon"><Icon size={20} /></div>
          <span>{label}</span>
          <strong>{loading ? "—" : value}</strong>
          <small>{note}</small>
        </article>
      ))}
    </section>

    <section className="panel flush">
      <div className="panel-heading">
        <div><p className="eyebrow">LIVE</p><h2>Sessiyalar</h2></div>
        <button className="secondary-button compact" type="button" onClick={() => setLiveOnly((value) => !value)}>
          {liveOnly ? "Barchasini ko‘rsatish" : "Faqat jonli"}
        </button>
      </div>
      {loading ? <TableSkeleton /> : sessions.length === 0 ? (
        <EmptyState title="Sessiya yo‘q" detail={liveOnly ? "Hozir jonli o‘yin o‘tkazilmayapti." : "Hali o‘yin o‘tkazilmagan."} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>O‘yin</th><th>Boshlovchi</th><th>Holat</th><th>Ishtirokchi</th><th>Savol</th><th>Mukofot</th><th>Boshlangan</th><th /></tr></thead>
            <tbody>
              {sessions.map((session) => {
                const live = !["finished", "cancelled", "expired"].includes(session.status);
                return (
                  <tr key={session.id}>
                    <td><strong>{session.game_title}</strong></td>
                    <td><small>{session.host_email ?? "—"}</small></td>
                    <td><StatusBadge value={session.status} /><small>{SESSION_LABELS[session.status] ?? session.status}</small></td>
                    <td>{number(session.player_count)}</td>
                    <td>{session.question_count > 0 ? `${session.current_index + 1} / ${session.question_count}` : "—"}</td>
                    <td>{session.reward_reserved > 0 ? `${number(session.reward_reserved)} J` : "—"}</td>
                    <td>{session.started_at ? stamp(session.started_at) : stamp(session.created_at)}</td>
                    <td>
                      {live ? (
                        <button
                          className="secondary-button compact danger"
                          type="button"
                          disabled={busy === session.id}
                          onClick={() => { setTerminating(session); setReason(""); setModalError(null); }}
                        >
                          <Ban size={15} /> To‘xtatish
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>

    <form className="toolbar" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
      <div className="search-box">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="O‘yin nomi yoki muallif emaili" />
      </div>
      <button className="secondary-button compact" type="submit">Qidirish</button>
    </form>

    <section className="panel flush">
      <div className="panel-heading">
        <div><p className="eyebrow">CATALOGUE</p><h2>O‘yinlar</h2></div>
      </div>
      {loading ? <TableSkeleton /> : games.length === 0 ? (
        <EmptyState title="O‘yin topilmadi" detail="Qidiruv shartiga mos o‘yin yo‘q." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>O‘yin</th><th>Muallif</th><th>Kategoriya</th><th>Manba</th><th>Savol</th><th>O‘yin soni</th><th>Do‘kon</th><th>Holat</th><th /></tr></thead>
            <tbody>
              {games.map((game) => (
                <tr key={game.id}>
                  <td>
                    <strong>{game.title || "Nomsiz o‘yin"}</strong>
                    {game.is_free ? <small>Bepul{game.featured ? " · Tanlangan" : ""}</small> : null}
                  </td>
                  <td><small>{game.owner_email ?? "—"}</small></td>
                  <td><small>{game.category_label ?? "—"}</small></td>
                  <td><small>{SOURCE_LABELS[game.source_type] ?? game.source_type}</small></td>
                  <td>{number(game.question_count)}</td>
                  <td>{number(game.sessions_count)}</td>
                  <td><small>{game.marketplace_status ?? "—"}</small></td>
                  <td><StatusBadge value={game.status} /></td>
                  <td className="row-actions">
                    {game.status === "ready" ? (
                      game.is_free ? (
                        <>
                          <button className="secondary-button compact" type="button" disabled={busy === game.id}
                            onClick={() => void moderate(game, "unset_free")} title="Bepul belgisini olish">
                            <EyeOff size={15} /> Bepulni olish
                          </button>
                          <button className="secondary-button compact" type="button" disabled={busy === game.id}
                            onClick={() => void moderate(game, game.featured ? "unfeature" : "feature")}
                            title={game.featured ? "Tanlanganlardan olish" : "Tanlanganlarga qo‘shish"}>
                            {game.featured ? <StarOff size={15} /> : <Star size={15} />}
                          </button>
                        </>
                      ) : (
                        <button className="secondary-button compact" type="button" disabled={busy === game.id}
                          onClick={() => void moderate(game, "set_free")} title="Bepul o‘yinlar ro‘yxatiga qo‘shish">
                          <Eye size={15} /> Bepul qilish
                        </button>
                      )
                    ) : null}
                    {game.status === "archived" ? (
                      <button className="secondary-button compact" type="button" disabled={busy === game.id}
                        onClick={() => void moderate(game, "restore")}>
                        Tiklash
                      </button>
                    ) : (
                      <button className="secondary-button compact danger" type="button" disabled={busy === game.id}
                        onClick={() => void moderate(game, "hide")}>
                        <Ban size={15} /> Yashirish
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

    <section className="panel flush">
      <div className="panel-heading">
        <div><p className="eyebrow">CATEGORIES</p><h2>Kategoriyalar</h2></div>
        <button
          className="secondary-button compact"
          type="button"
          onClick={() => {
            setEditingCategory("new");
            setCategoryForm({ code: "", label: "", icon: "", sort_order: (categories.at(-1)?.sort_order ?? 0) + 10, is_active: true });
            setModalError(null);
          }}
        >
          Yangi kategoriya
        </button>
      </div>
      {loading ? <TableSkeleton rows={3} /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nom</th><th>Kod</th><th>Ikonka</th><th>Tartib</th><th>Holat</th><th /></tr></thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td><strong>{category.label}</strong></td>
                  <td><small>{category.code}</small></td>
                  <td><small>{category.icon || "—"}</small></td>
                  <td>{category.sort_order}</td>
                  <td><StatusBadge value={category.is_active ? "active" : "hidden"} /></td>
                  <td className="row-actions">
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => {
                        setEditingCategory(category);
                        setCategoryForm({
                          code: category.code, label: category.label, icon: category.icon,
                          sort_order: category.sort_order, is_active: category.is_active,
                        });
                        setModalError(null);
                      }}
                    >
                      Tahrirlash
                    </button>
                    <button className="secondary-button compact danger" type="button" disabled={busy === category.id}
                      onClick={() => void deleteCategory(category)}>
                      O‘chirish
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

    {terminating && (
      <Modal
        title="Jonli o‘yinni to‘xtatish"
        description="O‘yin darhol bekor qilinadi, mukofot jamg‘armasi boshlovchiga qaytariladi. Sabab audit jurnaliga yoziladi."
        onClose={() => { setTerminating(null); setModalError(null); }}
      >
        <form onSubmit={(event) => void terminate(event)}>
          <label>To‘xtatish sababi
            <textarea maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}
              placeholder="Nima uchun to‘xtatilyapti" />
          </label>
          {modalError && <div className="error-banner">{modalError}</div>}
          <button className="primary-button" type="submit" disabled={busy === terminating.id}>O‘yinni to‘xtatish</button>
        </form>
      </Modal>
    )}

    {editingCategory && (
      <Modal
        title={editingCategory === "new" ? "Yangi kategoriya" : "Kategoriyani tahrirlash"}
        description="Kategoriyalar O‘yingoh bosh sahifasida ko‘rinadi. Kod o‘zgarmas identifikator."
        onClose={() => { setEditingCategory(null); setModalError(null); }}
      >
        <form onSubmit={(event) => void saveCategory(event)}>
          <label>Nom
            <input required value={categoryForm.label} placeholder="Masalan: Matematika"
              onChange={(event) => setCategoryForm({ ...categoryForm, label: event.target.value })} />
          </label>
          <label>Kod <span className="muted" style={{ fontWeight: 400 }}>(o‘zgarmas identifikator)</span>
            <input required value={categoryForm.code} placeholder="matematika"
              onChange={(event) => setCategoryForm({ ...categoryForm, code: event.target.value })} />
          </label>
          <label>Ikonka nomi <span className="muted" style={{ fontWeight: 400 }}>(lucide)</span>
            <input value={categoryForm.icon} placeholder="calculator"
              onChange={(event) => setCategoryForm({ ...categoryForm, icon: event.target.value })} />
          </label>
          <label>Tartib raqami
            <input type="number" value={categoryForm.sort_order}
              onChange={(event) => setCategoryForm({ ...categoryForm, sort_order: Number(event.target.value) })} />
          </label>
          <label className="switch-row">
            <input type="checkbox" checked={categoryForm.is_active}
              onChange={(event) => setCategoryForm({ ...categoryForm, is_active: event.target.checked })} />
            <span>Faol — foydalanuvchilarga ko‘rinadi</span>
          </label>
          {modalError && <div className="error-banner">{modalError}</div>}
          <button className="primary-button" type="submit">Saqlash</button>
        </form>
      </Modal>
    )}
  </div>;
}
