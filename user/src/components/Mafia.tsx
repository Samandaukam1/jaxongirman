import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Crown, HeartHandshake, Minus, Moon, Plus, Skull, ShieldCheck, Stethoscope, Sun, UserRound, Users, VenetianMask, type LucideIcon,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GameAvatar } from "@/components/GameAvatar";
import { PrimaryButton } from "@/components/PrimaryButton";
import { QrCode } from "@/components/QrCode";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import {
  gameJoinUrl, isMafiaSide, mafiaClose, mafiaDeal, mafiaEnd, mafiaMark, mafiaPhase, mafiaSeen, MAFIA_ROLES,
  type HostState, type MafiaPlayer, type MafiaRole, type MafiaSetup, type MafiaSpecial, type MafiaView, type MafiaWinner, type PlayerState,
} from "@/lib/games";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Mafia on the phones (§5.5). The host narrates; the app deals the cards,
 * keeps them private, and keeps the score of the night and the day.
 *
 * Every card has one look, used everywhere it appears: a glyph and a colour.
 * The mafia's side is drawn in crimson, the maniac in graphite, the town in
 * the brand's violet with each special role a hue of its own — so a table of
 * cards reads at a glance without becoming a rainbow.
 */
export const MAFIA_LOOK: Record<MafiaRole, { icon: LucideIcon; color: string; deep: string }> = {
  don: { icon: Crown, color: "#A3213F", deep: "#4A0B1C" },
  mafia: { icon: VenetianMask, color: "#B4233C", deep: "#560F1D" },
  sheriff: { icon: ShieldCheck, color: "#3159D0", deep: "#14245E" },
  doctor: { icon: Stethoscope, color: "#13896A", deep: "#06392B" },
  lover: { icon: HeartHandshake, color: "#B93478", deep: "#4F0F31" },
  maniac: { icon: Skull, color: "#4A4F5C", deep: "#17191F" },
  civilian: { icon: UserRound, color: "#6C34C9", deep: "#2A0F55" },
};

const SPECIALS: MafiaSpecial[] = ["don", "sheriff", "doctor", "lover", "maniac"];

export function mafiaSide(role: MafiaRole): "mafia" | "town" | "maniac" {
  return isMafiaSide(role) ? "mafia" : role === "maniac" ? "maniac" : "town";
}

/** A sensible deck for a table of `count`: about one mafioso in four, a Don from six. */
export function suggestedSetup(count: number): MafiaSetup {
  const side = Math.max(1, Math.round(count / 4));
  const don = count >= 6 ? 1 : 0;
  return {
    mafia: Math.max(0, side - don), don,
    sheriff: count >= 5 ? 1 : 0, doctor: 1, lover: count >= 8 ? 1 : 0, maniac: 0,
  };
}

function setupProblem(setup: MafiaSetup, count: number): "needPlayers" | "tooManyMafia" | "tooManyRoles" | null {
  if (count < 4) return "needPlayers";
  const side = setup.mafia + setup.don;
  if (side < 1 || side * 2 >= count) return "tooManyMafia";
  const special = side + setup.sheriff + setup.doctor + setup.lover + setup.maniac;
  return special > count ? "tooManyRoles" : null;
}

/* ------------------------------------------------------------------ card -- */

/** A card's face: its colour, its glyph, its name and whose side it is on. */
export function MafiaCardFace({ role, children, compact }: { role: MafiaRole; children?: ReactNode; compact?: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation("games");
  const look = MAFIA_LOOK[role];
  const Icon = look.icon;
  return (
    <LinearGradient colors={[look.color, look.deep]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.face, compact ? styles.faceCompact : styles.faceFill]}>
      <View style={styles.faceRing}>
        <Icon color="#FFFFFF" size={compact ? 34 : 54} strokeWidth={1.7} />
      </View>
      <Text style={[styles.faceName, compact && styles.faceNameCompact]}>{t(`mafia.roles.${role}`)}</Text>
      <Text style={styles.faceSide}>{t(`mafia.side.${mafiaSide(role)}`)}</Text>
      {compact ? null : <Text style={styles.faceAbout}>{t(`mafia.about.${role}`)}</Text>}
      {children}
    </LinearGradient>
  );
}

/** The back every card shares, so a glance across the table gives nothing away. */
function CardBack() {
  const styles = useStyles();
  const { t } = useTranslation("games");
  return (
    <LinearGradient colors={["#3A1573", "#160733"]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.face, styles.faceFill]}>
      <View style={styles.backFrame} />
      <View style={[styles.faceRing, styles.backRing]}>
        <VenetianMask color="rgba(255,255,255,0.92)" size={58} strokeWidth={1.5} />
      </View>
      <Text style={styles.backTitle}>{t("mafia.title").toUpperCase()}</Text>
      <Text style={styles.backHint}>{t("mafia.holdToSee")}</Text>
    </LinearGradient>
  );
}

/**
 * The player's card, face down. Held, it turns over; let go, it turns back —
 * a neighbour glancing at the phone sees only the back. The first look tells
 * the host this player has seen their card.
 */
function HoldCard({ sessionId, view }: { sessionId: string; view: MafiaView }) {
  const styles = useStyles();
  const { t } = useTranslation("games");
  const turn = useSharedValue(0);
  const told = useRef(view.me?.seen ?? false);
  const me = view.me!;

  const back = useAnimatedStyle(() => ({
    opacity: turn.value < 0.5 ? 1 : 0,
    transform: [{ perspective: 1200 }, { rotateY: `${interpolate(turn.value, [0, 1], [0, 180])}deg` }],
  }));
  const front = useAnimatedStyle(() => ({
    opacity: turn.value >= 0.5 ? 1 : 0,
    transform: [{ perspective: 1200 }, { rotateY: `${interpolate(turn.value, [0, 1], [-180, 0])}deg` }],
  }));

  function show(open: boolean) {
    turn.set(withTiming(open ? 1 : 0, { duration: 240 }));
    if (!open) return;
    void Haptics.selectionAsync();
    if (!told.current) {
      told.current = true;
      void mafiaSeen(sessionId).catch(() => { told.current = false; });
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mafia.holdToSee")}
      onPressIn={() => show(true)}
      onPressOut={() => show(false)}
      style={styles.cardSlot}
    >
      <Animated.View style={[styles.cardLayer, back]}>
        <CardBack />
      </Animated.View>
      <Animated.View style={[styles.cardLayer, front]}>
        <MafiaCardFace role={me.role}>
          {view.team && view.team.length > 0 ? (
            <View style={styles.partners}>
              <Text style={styles.partnersLabel}>{t("mafia.partners")}</Text>
              {view.team.map((mate) => (
                <View key={mate.id} style={styles.partnerRow}>
                  <GameAvatar id={mate.avatar_id} size={26} />
                  <Text style={[styles.partnerName, !mate.alive && styles.struck]} numberOfLines={1}>{mate.nickname}</Text>
                  <Text style={styles.partnerRole}>{t(`mafia.roles.${mate.role}`)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </MafiaCardFace>
      </Animated.View>
    </Pressable>
  );
}

/** Night or day, and which. */
function PhasePill({ view, large }: { view: MafiaView; large?: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation("games");
  const night = view.phase === "night";
  const Icon = night ? Moon : Sun;
  return (
    <View style={[styles.phase, night ? styles.phaseNight : styles.phaseDay, large && styles.phaseLarge]}>
      <Icon color={night ? "#E9E2FF" : "#7A4A00"} size={large ? 20 : 15} strokeWidth={2.2} />
      <Text style={[styles.phaseText, night ? styles.phaseTextNight : styles.phaseTextDay, large && styles.phaseTextLarge]}>
        {t(night ? "mafia.roundNight" : "mafia.roundDay", { round: view.round })}
      </Text>
    </View>
  );
}

function WinnerBanner({ winner }: { winner: MafiaWinner | null }) {
  const styles = useStyles();
  const { t } = useTranslation("games");
  const look = winner === "mafia" ? MAFIA_LOOK.mafia : winner === "maniac" ? MAFIA_LOOK.maniac : MAFIA_LOOK.civilian;
  return (
    <Animated.View entering={FadeInDown.duration(380)}>
      <LinearGradient colors={[look.color, look.deep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.winner}>
        <Crown color="#FFFFFF" size={26} strokeWidth={2} />
        <Text style={styles.winnerText}>{t(`mafia.winner.${winner ?? "none"}`)}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

/** Everyone at the table with their card shown — the host's view, or anyone's once a game is over. */
function RevealList({ players }: { players: MafiaPlayer[] }) {
  const styles = useStyles();
  const { t } = useTranslation("games");
  const dealt = players.filter((player) => player.in_game && player.role);
  return (
    <View style={styles.list}>
      <Text style={styles.sectionLabel}>{t("mafia.allRoles")}</Text>
      {/* Who looked at their card no longer matters once every card is shown. */}
      {dealt.map((player) => <PlayerRow key={player.id} player={{ ...player, seen: null }} />)}
    </View>
  );
}

function RoleChip({ role }: { role: MafiaRole }) {
  const styles = useStyles();
  const { t } = useTranslation("games");
  const look = MAFIA_LOOK[role];
  const Icon = look.icon;
  return (
    <View style={[styles.chip, { backgroundColor: `${look.color}1F`, borderColor: `${look.color}55` }]}>
      <Icon color={look.color} size={14} strokeWidth={2.2} />
      <Text style={[styles.chipText, { color: look.color }]} numberOfLines={1}>{t(`mafia.roles.${role}`)}</Text>
    </View>
  );
}

function PlayerRow({ player, onPress, open, children }: { player: MafiaPlayer; onPress?: () => void; open?: boolean; children?: ReactNode }) {
  const styles = useStyles();
  const { t } = useTranslation("games");
  const out = player.in_game && !player.alive;
  return (
    <View style={[styles.row, open && styles.rowOpen]}>
      <Pressable disabled={!onPress} onPress={onPress} style={styles.rowMain} accessibilityRole={onPress ? "button" : undefined}>
        <View style={out ? styles.dim : undefined}><GameAvatar id={player.avatar_id} size={40} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.rowName, out && styles.struck]} numberOfLines={1}>{player.nickname}</Text>
          {out && player.out_reason ? (
            <Text style={styles.rowOut}>{t(`mafia.outShort.${player.out_reason}`, { round: player.out_round ?? 1 })}</Text>
          ) : player.seen === false ? <Text style={styles.rowMeta}>{t("mafia.notSeen")}</Text> : null}
        </View>
        {player.role ? <RoleChip role={player.role} /> : null}
      </Pressable>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ host -- */

type LobbyPlayer = { id: string; nickname: string; avatar_id: number };

/**
 * The narrator's side: the room and the deck before a game, the table during
 * it, every card after it. Each tap is one server call; the phones and the
 * board follow the session row.
 */
export function MafiaHost({ sessionId, state, showQr, onChanged, onCancel }: {
  sessionId: string;
  state: HostState;
  showQr: boolean;
  onChanged: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation(["games", "play", "common"]);
  const router = useRouter();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyPlayer[]>([]);
  const [setup, setSetup] = useState<MafiaSetup | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [closing, setClosing] = useState(false);
  const view = state.mafia ?? null;
  const live = state.status === "question" && view !== null && !view.over;

  // Who is in the room, for the deal: the host's own account is never dealt.
  useEffect(() => {
    let alive = true;
    void supabase.from("game_players").select("id, nickname, avatar_id, user_id, status").eq("session_id", sessionId).order("joined_at")
      .then(({ data }) => {
        if (!alive) return;
        setLobby(((data ?? []) as (LobbyPlayer & { user_id: string; status: string })[])
          .filter((row) => row.status !== "kicked" && row.user_id !== user?.id));
      });
    return () => { alive = false; };
  }, [sessionId, state.state_version, user?.id]);

  async function act(work: () => Promise<unknown>, feel?: Haptics.NotificationFeedbackType) {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (feel !== undefined) void Haptics.notificationAsync(feel);
      await onChanged();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const count = lobby.length;
  // The last game's deck carries over; before the first, a deck that fits the room.
  const previous = view?.roles
    ? { mafia: view.roles.mafia, don: view.roles.don, sheriff: view.roles.sheriff, doctor: view.roles.doctor, lover: view.roles.lover, maniac: view.roles.maniac } as MafiaSetup
    : null;
  const deck = setup ?? previous ?? suggestedSetup(count);
  const dealing = state.status === "lobby" || (view?.over ?? false);

  if (state.status === "finished" || state.status === "cancelled" || state.status === "expired") {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("mafia.closed")}</Text>
        {view ? <WinnerBanner winner={view.winner} /> : null}
        {view ? <RevealList players={view.players} /> : null}
        <PrimaryButton label={t("grid.leave")} tone="secondary" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* ------------------------------------------------ the door */}
      {state.status === "lobby" ? (
        <View style={styles.codeCard}>
          {showQr ? <View style={styles.qrFrame}><QrCode value={gameJoinUrl(state.join_token)} size={196} /></View> : null}
          <Text style={styles.codeLabel}>{t("play:host.code")}</Text>
          <Text style={styles.codeValue}>{state.join_code.replace(/(\d{3})(\d{3})/, "$1 $2")}</Text>
          <Text style={styles.codeHint}>{showQr ? t("play:host.scanHint") : t("play:host.codeHint")}</Text>
        </View>
      ) : null}

      {/* ---------------------------------------------- the game on */}
      {live && view ? (
        <>
          <View style={styles.liveHead}>
            <PhasePill view={view} large />
            <Text style={styles.liveMeta}>{t("mafia.aliveCount", { count: view.players.filter((p) => p.in_game && p.alive).length })}</Text>
          </View>
          {view.players.some((p) => p.in_game && p.seen === false) ? (
            <Text style={styles.hint}>
              {t("mafia.seenCount", { seen: view.players.filter((p) => p.in_game && p.seen).length, total: view.players.filter((p) => p.in_game).length })}
            </Text>
          ) : null}
          <PrimaryButton
            label={view.phase === "night" ? t("mafia.toDay") : t("mafia.toNight")}
            icon={view.phase === "night" ? Sun : Moon}
            tone="secondary"
            disabled={busy}
            onPress={() => void act(() => mafiaPhase(sessionId, view.phase === "night" ? "day" : "night"))}
          />
          {view.verdict ? (
            <Animated.View entering={FadeIn.duration(260)} style={styles.verdict}>
              <Text style={styles.verdictText}>{t(`mafia.verdict.${view.verdict}`)}</Text>
              <PrimaryButton label={t("mafia.endNow")} disabled={busy}
                onPress={() => void act(() => mafiaEnd(sessionId, view.verdict ?? null), Haptics.NotificationFeedbackType.Success)} />
            </Animated.View>
          ) : null}

          <View style={styles.list}>
            <Text style={styles.sectionLabel}>{t("mafia.players")}</Text>
            <Text style={styles.hint}>{t("mafia.tapHint")}</Text>
            {view.players.filter((p) => p.in_game).map((player) => (
              <PlayerRow key={player.id} player={player} open={picked === player.id}
                onPress={() => { setPicked(picked === player.id ? null : player.id); void Haptics.selectionAsync(); }}>
                {picked === player.id ? (
                  <Animated.View entering={FadeIn.duration(180)} style={styles.rowActions}>
                    {player.alive ? (
                      <>
                        <ActionChip label={t("mafia.out.night")} icon={Moon} disabled={busy}
                          onPress={() => { setPicked(null); void act(() => mafiaMark(sessionId, player.id, false, "night"), Haptics.NotificationFeedbackType.Warning); }} />
                        <ActionChip label={t("mafia.out.vote")} icon={Users} disabled={busy}
                          onPress={() => { setPicked(null); void act(() => mafiaMark(sessionId, player.id, false, "vote"), Haptics.NotificationFeedbackType.Warning); }} />
                      </>
                    ) : (
                      <ActionChip label={t("mafia.bringBack")} icon={Plus} disabled={busy}
                        onPress={() => { setPicked(null); void act(() => mafiaMark(sessionId, player.id, true)); }} />
                    )}
                  </Animated.View>
                ) : null}
              </PlayerRow>
            ))}
            {view.players.some((p) => !p.in_game) ? (
              <Text style={styles.hint}>
                {view.players.filter((p) => !p.in_game).map((p) => p.nickname).join(", ")} — {t("mafia.waiting").toLowerCase()}
              </Text>
            ) : null}
          </View>

          {ending ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.endBox}>
              <Text style={styles.sectionLabel}>{t("mafia.endTitle")}</Text>
              <View style={styles.endRow}>
                {(["town", "mafia", ...(view.roles.maniac ? ["maniac"] : []), "none"] as (MafiaWinner | "none")[]).map((winner) => (
                  <Pressable key={winner} disabled={busy} style={styles.endChoice}
                    onPress={() => { setEnding(false); void act(() => mafiaEnd(sessionId, winner === "none" ? null : winner), Haptics.NotificationFeedbackType.Success); }}>
                    <Text style={styles.endChoiceText}>{t(`mafia.pick.${winner}`)}</Text>
                  </Pressable>
                ))}
              </View>
              <PrimaryButton label={t("common:cancel")} tone="ghost" onPress={() => setEnding(false)} />
            </Animated.View>
          ) : (
            <PrimaryButton label={t("mafia.end")} tone="secondary" disabled={busy} onPress={() => setEnding(true)} />
          )}
        </>
      ) : null}

      {/* ---------------------------------------------- a game over */}
      {view?.over && state.status === "question" ? (
        <>
          <WinnerBanner winner={view.winner} />
          <RevealList players={view.players} />
        </>
      ) : null}

      {/* --------------------------------------------- the deck */}
      {dealing ? (
        <View style={styles.block}>
          <View style={styles.blockHead}>
            <Text style={styles.title}>{view?.over ? t("mafia.dealAgain") : t("mafia.setup")}</Text>
            <View style={styles.countPill}>
              <Users color="#6C34C9" size={15} strokeWidth={2.2} />
              <Text style={styles.countText}>{count}</Text>
            </View>
          </View>
          {count > 0 ? (
            <View style={styles.avatars}>
              {lobby.map((player) => (
                <View key={player.id} style={styles.avatarItem}>
                  <GameAvatar id={player.avatar_id} size={38} />
                  <Text style={styles.avatarName} numberOfLines={1}>{player.nickname}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={styles.hint}>{t("mafia.setupHint")}</Text>

          <View style={styles.setupRow}>
            <RoleChip role="mafia" />
            <View style={{ flex: 1 }} />
            <Pressable accessibilityLabel="-" disabled={deck.mafia <= 0} style={styles.stepper}
              onPress={() => setSetup({ ...deck, mafia: Math.max(0, deck.mafia - 1) })}>
              <Minus color="#6C34C9" size={18} strokeWidth={2.4} />
            </Pressable>
            <Text style={styles.stepValue}>{deck.mafia}</Text>
            <Pressable accessibilityLabel="+" style={styles.stepper} onPress={() => setSetup({ ...deck, mafia: deck.mafia + 1 })}>
              <Plus color="#6C34C9" size={18} strokeWidth={2.4} />
            </Pressable>
          </View>
          {SPECIALS.map((role) => {
            const on = deck[role] === 1;
            return (
              <Pressable key={role} accessibilityRole="switch" accessibilityState={{ checked: on }}
                onPress={() => { setSetup({ ...deck, [role]: on ? 0 : 1 }); void Haptics.selectionAsync(); }}
                style={[styles.setupRow, !on && styles.setupOff]}>
                <RoleChip role={role} />
                <Text style={styles.setupAbout} numberOfLines={2}>{t(`mafia.about.${role}`)}</Text>
                <View style={[styles.switch, on && styles.switchOn]}><View style={[styles.knob, on && styles.knobOn]} /></View>
              </Pressable>
            );
          })}
          <View style={styles.setupRow}>
            <RoleChip role="civilian" />
            <View style={{ flex: 1 }} />
            <Text style={styles.stepValue}>
              {Math.max(0, count - deck.mafia - deck.don - deck.sheriff - deck.doctor - deck.lover - deck.maniac)}
            </Text>
          </View>

          {(() => {
            const problem = setupProblem(deck, count);
            return (
              <>
                {problem ? <Text style={styles.warn}>{t(`mafia.${problem}`, { count })}</Text> : null}
                <PrimaryButton
                  label={t("mafia.deal")}
                  icon={VenetianMask}
                  loading={busy}
                  disabled={busy || problem !== null}
                  onPress={() => void act(() => mafiaDeal(sessionId, deck), Haptics.NotificationFeedbackType.Success)}
                />
              </>
            );
          })()}
        </View>
      ) : null}

      {error ? <InlineError message={error} /> : null}

      {view?.over && state.status === "question" ? (
        closing ? (
          <View style={styles.endBox}>
            <Text style={styles.hint}>{t("mafia.closeConfirm")}</Text>
            <PrimaryButton label={t("mafia.close")} disabled={busy} onPress={() => void act(() => mafiaClose(sessionId))} />
            <PrimaryButton label={t("common:cancel")} tone="ghost" onPress={() => setClosing(false)} />
          </View>
        ) : <PrimaryButton label={t("mafia.close")} tone="ghost" disabled={busy} onPress={() => setClosing(true)} />
      ) : null}
      {state.status === "lobby" ? <PrimaryButton label={t("common:cancel")} tone="ghost" disabled={busy} onPress={onCancel} /> : null}
    </ScrollView>
  );
}

function ActionChip({ label, icon: Icon, onPress, disabled }: { label: string; icon: LucideIcon; onPress: () => void; disabled?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}>
      <Icon color={colors.primaryDeep} size={16} strokeWidth={2.2} />
      <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- player -- */

/**
 * A player's phone through a whole Mafia session: waiting for the deal, the
 * card held face down, being out, and every card once a game is over.
 */
export function MafiaPlayerScreen({ sessionId, state, connected, offlineLabel }: {
  sessionId: string;
  state: PlayerState;
  connected: boolean;
  offlineLabel: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation(["games", "play"]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const view = state.mafia ?? null;
  const me = state.me;
  const closed = state.status === "finished" || state.status === "cancelled" || state.status === "expired";
  const dealtIn = view?.me != null;
  const alive = useMemo(() => view?.players.filter((p) => p.in_game && p.alive).length ?? 0, [view]);

  // A card being lost is felt: one buzz when this player is taken out.
  const wasAlive = useRef(view?.me?.alive ?? true);
  useEffect(() => {
    const now = view?.me?.alive ?? true;
    if (wasAlive.current && !now) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    wasAlive.current = now;
  }, [view?.me?.alive]);

  return (
    <View style={[styles.safe, { paddingTop: Math.max(insets.top, 20) + spacing.xs }]}>
      {!connected ? <View style={styles.offline}><Text style={styles.offlineText}>{offlineLabel}</Text></View> : null}
      <View style={styles.header}>
        <GameAvatar id={me.avatar_id} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.myName} numberOfLines={1}>{me.nickname}</Text>
          <Text style={styles.myMeta}>{t("mafia.title")}{view && !view.over && !closed ? ` · ${t("mafia.aliveCount", { count: alive })}` : ""}</Text>
        </View>
        {view && !view.over && !closed ? <PhasePill view={view} /> : null}
      </View>

      <ScrollView contentContainerStyle={[styles.playerContent, { paddingBottom: insets.bottom + spacing.xxl }]} showsVerticalScrollIndicator={false}>
        {!view && !closed ? (
          <View style={styles.wait}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.waitTitle}>{t("mafia.waitDeal")}</Text>
            <Text style={styles.waitText}>{t("play:host.players", { count: state.player_count })}</Text>
          </View>
        ) : null}

        {view && !dealtIn && !view.over && !closed ? (
          <View style={styles.wait}>
            <Moon color={colors.primary} size={40} strokeWidth={1.6} />
            <Text style={styles.waitTitle}>{t("mafia.waitNext")}</Text>
          </View>
        ) : null}

        {view && dealtIn && !view.over && !closed ? (
          <>
            {!view.me!.alive ? (
              <Animated.View entering={FadeInDown.duration(300)} style={styles.outBanner}>
                <Skull color={colors.danger} size={22} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.outTitle}>{t("mafia.youAreOut")}</Text>
                  <Text style={styles.outText}>
                    {view.me!.out_reason ? `${t(`mafia.out.${view.me!.out_reason}`)}. ` : ""}{t("mafia.youAreOutHint")}
                  </Text>
                </View>
              </Animated.View>
            ) : null}
            <HoldCard sessionId={sessionId} view={view} />
            <Text style={styles.holdHint}>{t("mafia.holdHint")}</Text>
          </>
        ) : null}

        {view && (view.over || closed) ? (
          <>
            <WinnerBanner winner={view.winner} />
            {view.me ? (
              <View style={styles.myCardSmall}>
                <Text style={styles.sectionLabel}>{t("mafia.yourRole")}</Text>
                <MafiaCardFace role={view.me.role} compact />
              </View>
            ) : null}
            <RevealList players={view.players} />
          </>
        ) : null}

        {closed ? (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.waitTitle}>{t("mafia.closed")}</Text>
            <PrimaryButton label={t("play:back")} onPress={() => router.replace("/(app)/(tabs)/games")} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** All seven cards, for the screen that introduces the game. */
export function MafiaRoleGallery() {
  const styles = useStyles();
  const { t } = useTranslation("games");
  return (
    <View style={styles.gallery}>
      {MAFIA_ROLES.map((role) => {
        const look = MAFIA_LOOK[role];
        const Icon = look.icon;
        return (
          <View key={role} style={styles.galleryRow}>
            <LinearGradient colors={[look.color, look.deep]} style={styles.galleryIcon}>
              <Icon color="#FFFFFF" size={22} strokeWidth={1.9} />
            </LinearGradient>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.galleryName}>{t(`mafia.roles.${role}`)}</Text>
              <Text style={styles.galleryAbout}>{t(`mafia.about.${role}`)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
  playerContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.lg },
  title: { ...typography.heading, color: colors.ink },
  hint: { ...typography.caption, fontSize: 13, color: colors.inkMuted },
  warn: { ...typography.caption, fontSize: 13, color: colors.danger },
  sectionLabel: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", letterSpacing: 0.6, textTransform: "uppercase", color: colors.inkMuted },

  // The door.
  codeCard: { alignItems: "center", gap: 4, backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.xl },
  qrFrame: { padding: spacing.md, backgroundColor: "#FFFFFF", borderRadius: radius.md, marginBottom: spacing.sm },
  codeLabel: { ...typography.caption, color: colors.primaryDeep },
  codeValue: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 40, color: colors.primaryDeep, letterSpacing: 4 },
  codeHint: { ...typography.caption, color: colors.inkMuted, textAlign: "center" },

  // The deck.
  block: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  blockHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  countPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  countText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 14, color: colors.primaryDeep },
  avatars: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  avatarItem: { alignItems: "center", gap: 2, width: 58 },
  avatarName: { ...typography.caption, fontSize: 11, color: colors.inkMuted, maxWidth: 58 },
  setupRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10, paddingHorizontal: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceMuted,
  },
  setupOff: { opacity: 0.62 },
  setupAbout: { flex: 1, ...typography.caption, fontSize: 12, lineHeight: 16, color: colors.inkMuted },
  stepper: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  stepValue: { minWidth: 28, textAlign: "center", fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 18, color: colors.ink },
  switch: { width: 44, height: 26, borderRadius: 13, padding: 3, backgroundColor: colors.borderStrong },
  switchOn: { backgroundColor: colors.primary },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#FFFFFF" },
  knobOn: { transform: [{ translateX: 18 }] },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, maxWidth: 150 },
  chipText: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 12.5 },

  // The table.
  liveHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  liveMeta: { ...typography.bodyMedium, color: colors.inkMuted },
  verdict: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: colors.successBorder },
  verdictText: { ...typography.bodyMedium, color: colors.ink, textAlign: "center" },
  list: { gap: spacing.sm },
  row: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  rowOpen: { borderColor: colors.primary },
  rowMain: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  rowName: { ...typography.bodyMedium, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.inkSoft },
  rowOut: { ...typography.caption, color: colors.danger },
  rowActions: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  action: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 42, paddingHorizontal: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.primarySoft,
  },
  actionText: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 13, color: colors.primaryDeep, flexShrink: 1 },
  struck: { textDecorationLine: "line-through", color: colors.inkSoft },
  dim: { opacity: 0.4 },
  endBox: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  endRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  endChoice: { flexGrow: 1, minWidth: "45%", alignItems: "center", paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  endChoiceText: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 14, color: colors.primaryDeep },
  winner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg },
  winnerText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 19, color: "#FFFFFF", flexShrink: 1, textAlign: "center" },

  phase: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill },
  phaseLarge: { paddingHorizontal: 14, paddingVertical: 9 },
  phaseNight: { backgroundColor: "#2A0F55" },
  phaseDay: { backgroundColor: "#FFE7B3" },
  phaseText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 13 },
  phaseTextLarge: { fontSize: 16 },
  phaseTextNight: { color: "#E9E2FF" },
  phaseTextDay: { color: "#7A4A00" },

  // The card.
  cardSlot: { alignSelf: "center", width: "100%", maxWidth: 360, aspectRatio: 0.68 },
  cardLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backfaceVisibility: "hidden" },
  face: { borderRadius: 28, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm, overflow: "hidden" },
  // The held card fills its slot; the small one after a game is as tall as what it says.
  faceFill: { flex: 1 },
  faceCompact: { paddingVertical: spacing.xl, borderRadius: 22 },
  faceRing: {
    width: 104, height: 104, borderRadius: 52, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.35)",
  },
  faceName: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 34, lineHeight: 40, color: "#FFFFFF", textAlign: "center" },
  faceNameCompact: { fontSize: 26, lineHeight: 31 },
  faceSide: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 13, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(255,255,255,0.75)" },
  faceAbout: { fontFamily: "JaxongirmanSans_500Medium", fontSize: 15, lineHeight: 21, color: "rgba(255,255,255,0.92)", textAlign: "center", marginTop: spacing.sm },
  partners: { alignSelf: "stretch", gap: 6, marginTop: spacing.md, padding: spacing.md, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.22)" },
  partnersLabel: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", color: "rgba(255,255,255,0.7)" },
  partnerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  partnerName: { flex: 1, fontFamily: "JaxongirmanSans_700Bold", fontSize: 15, color: "#FFFFFF" },
  partnerRole: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 12.5, color: "rgba(255,255,255,0.75)" },
  backFrame: { position: "absolute", top: 14, left: 14, right: 14, bottom: 14, borderRadius: 20, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.16)" },
  backRing: { width: 124, height: 124, borderRadius: 62 },
  backTitle: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 26, letterSpacing: 6, color: "#FFFFFF" },
  backHint: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 14, color: "rgba(255,255,255,0.7)", textAlign: "center", marginTop: spacing.xs },
  holdHint: { ...typography.caption, fontSize: 13, color: colors.inkMuted, textAlign: "center" },
  myCardSmall: { gap: spacing.sm },

  // The player's frame.
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  myName: { ...typography.bodyMedium, color: colors.ink },
  myMeta: { ...typography.caption, color: colors.inkMuted },
  offline: { backgroundColor: colors.warningSoft, paddingVertical: 6, alignItems: "center" },
  offlineText: { ...typography.caption, color: colors.ink },
  wait: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxxl },
  waitTitle: { ...typography.heading, color: colors.ink, textAlign: "center" },
  waitText: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  outBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder,
  },
  outTitle: { ...typography.bodyMedium, color: colors.ink },
  outText: { ...typography.caption, fontSize: 13, color: colors.inkMuted },

  // The gallery.
  gallery: { gap: spacing.sm },
  galleryRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  galleryIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  galleryName: { ...typography.bodyMedium, color: colors.ink },
  galleryAbout: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
}));
