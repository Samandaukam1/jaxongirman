import * as Haptics from "expo-haptics";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowUpRight, AudioLines, Ban, Bell, BellOff, ChevronLeft, FolderOpen, Gamepad2, Images, Layers, LibraryBig, Pencil, Play, Presentation, Share2,
  UserPlus, type LucideIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Image, Modal, Pressable, Share, Text, TextInput, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeInDown, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, FeGaussianBlur, Filter, G, Image as SvgImage, LinearGradient as SvgGradient, Mask, RadialGradient, Rect, Stop } from "react-native-svg";

import { PictureViewer, usePath, VideoNote, VoiceMessage } from "@/components/ChatBubbles";
import { ActionSheet } from "@/components/ChatKit";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ProfileHeroCard, type CardAction, type CardStat } from "@/components/ProfileHeroCard";
import { InlineError } from "@/components/StateBlocks";
import {
  addToLibrary, blockUser, chatProfile, libraryHref, peerName, saveContact, sharedInConversation, unblockUser,
  type ChatMessage, type ChatPeer,
} from "@/lib/chat";
import { chatListTime, lastSeen, mediaLength } from "@/lib/chatTime";
import { asErrorMessage } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { useOwnCard } from "@/lib/useOwnCard";
import { stopVoice } from "@/lib/voicePlayer";
import { useAuth } from "@/providers/AuthProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

const APP_URL = "https://jaxongirman.app/ilova";
type Tab = "media" | "voice" | "decks" | "games";
const TABS: { key: Tab; icon: LucideIcon }[] = [
  { key: "media", icon: Images },
  { key: "voice", icon: AudioLines },
  { key: "decks", icon: Presentation },
  { key: "games", icon: Gamepad2 },
];
/** The card and the panel under it sit this far from the screen's edges. */
const EDGE = 10;
/** How far above the screen's top the glow is drawn, so a pull never bares its edge. */
const OVERDRAW = 320;
/** Voice messages in the tab fetched to the phone ahead of a tap; the older ones wait for theirs. */
const VOICE_AHEAD = 20;

/**
 * A profile opened from chat: the same card as Profil, a size larger and
 * nearer the edges, with its own way back in the photograph's corner — one's
 * own with its own four buttons, someone else's with Yuborish, Ulashish,
 * Saqlash/Tahrirlash and Sukut — and, under someone else's, what the two of
 * you have sent each other, in tabs as Telegram keeps them: media, voice,
 * decks, games. The photograph's colours glow on the screen round the card.
 */
export default function ChatProfileScreen() {
  const { userId, conversation } = useLocalSearchParams<{ userId: string; conversation?: string }>();
  const { user } = useAuth();
  const own = userId === "me" || userId === user?.id;
  return own ? <OwnProfile /> : <PeerProfile userId={userId ?? ""} conversation={typeof conversation === "string" ? conversation : null} />;
}

/** While there is no card yet to carry the way back. */
function Back() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8} style={[styles.back, { top: Math.max(insets.top, 20) + spacing.sm }]}>
      <ChevronLeft color={colors.ink} size={24} />
    </Pressable>
  );
}

/** The scroll offset the card stretches with when the screen is pulled past its top. */
function useCardScroll() {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => { scrollY.value = event.contentOffset.y; });
  return { scrollY, onScroll };
}

/**
 * What the card casts on the screen round it: its photograph, blurred past
 * recognition and fading down the page — or, with no photograph, the brand's
 * two lights. Drawn inside the scroll, so it travels with the card.
 */
function Glow({ uri }: { uri: string | null }) {
  const { scheme } = useTheme();
  const { width } = useWindowDimensions();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const height = OVERDRAW + Math.min(width, 560) * 1.9;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: -OVERDRAW, left: 0, right: 0, height, opacity: scheme === "dark" ? 0.75 : 0.6 }}>
      <Svg width={width} height={height}>
        <Defs>
          <SvgGradient id={`${id}fade`} x1="0" y1="0" x2="0" y2={height} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
            <Stop offset="0.6" stopColor="#FFFFFF" stopOpacity={0.8} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </SvgGradient>
          <Mask id={`${id}mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
            <Rect x="0" y="0" width={width} height={height} fill={`url(#${id}fade)`} />
          </Mask>
          <Filter id={`${id}blur`} x="-30%" y="-30%" width="160%" height="160%">
            <FeGaussianBlur stdDeviation={46} />
          </Filter>
          <RadialGradient id={`${id}lilac`} cx={width * 0.85} cy={OVERDRAW + 40} r={width * 0.9} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#A47BFF" stopOpacity={0.7} />
            <Stop offset="1" stopColor="#A47BFF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`${id}indigo`} cx={width * 0.1} cy={OVERDRAW + width * 0.9} r={width * 0.85} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#3C60F5" stopOpacity={0.45} />
            <Stop offset="1" stopColor="#3C60F5" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <G mask={`url(#${id}mask)`}>
          {uri ? (
            <G filter={`url(#${id}blur)`}>
              <SvgImage href={{ uri }} x={-width * 0.25} y={OVERDRAW - width * 0.3} width={width * 1.5} height={height - OVERDRAW + width * 0.3} preserveAspectRatio="xMidYMid slice" />
            </G>
          ) : (
            <>
              <Circle cx={width * 0.85} cy={OVERDRAW + 40} r={width * 0.9} fill={`url(#${id}lilac)`} />
              <Circle cx={width * 0.1} cy={OVERDRAW + width * 0.9} r={width * 0.85} fill={`url(#${id}indigo)`} />
            </>
          )}
        </G>
      </Svg>
    </View>
  );
}

function OwnProfile() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("profile");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const card = useOwnCard();
  const { scrollY, onScroll } = useCardScroll();
  return (
    <View style={styles.safe}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 10) + 6, paddingBottom: insets.bottom + spacing.xxl }]}
      >
        <Glow uri={card?.avatarUrl ?? null} />
        {card ? (
          <ProfileHeroCard
            size="large"
            onBack={() => router.back()}
            scrollY={scrollY}
            name={card.name || t("namePlaceholder")}
            handle={card.username ? `@${card.username}` : ""}
            bio={card.bio}
            study={card.study}
            avatarUrl={card.avatarUrl}
            initials={card.initials}
            tier={card.tier}
            planName={card.planName}
            decks={card.decks}
            games={card.games}
            coins={card.coins}
            onEdit={() => router.push("/(app)/profile-edit")}
            onSend={() => router.push("/(app)/coins/send")}
            onTopUp={() => router.push("/(app)/coins/buy")}
            onShare={() => {
              const message = card.username ? t("actions.shareMessage", { username: card.username }) : t("actions.shareMessagePlain");
              void Share.share({ message }).catch(() => undefined);
            }}
          />
        ) : <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxxl }} />}
      </Animated.ScrollView>
      {card ? null : <Back />}
    </View>
  );
}

function PeerProfile({ userId, conversation }: { userId: string; conversation: string | null }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["chat", "profile"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { scrollY, onScroll } = useCardScroll();
  const [peer, setPeer] = useState<ChatPeer | null>(null);
  const [items, setItems] = useState<ChatMessage[] | null>(null);
  const [tab, setTab] = useState<Tab>("media");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askBlock, setAskBlock] = useState(false);

  const load = useCallback(async () => {
    try {
      const [person, shared] = await Promise.all([chatProfile(userId), conversation ? sharedInConversation(conversation) : Promise.resolve([])]);
      setPeer(person);
      setName(person?.contact_name ?? "");
      setItems(shared);
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [conversation, userId]);
  useEffect(() => { void load(); }, [load]);

  // A voice from the tab plays on the app's one player: leaving the profile stops it.
  useFocusEffect(useCallback(() => () => { stopVoice(); }, []));

  async function contact(patch: { display_name?: string | null; muted?: boolean }) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await saveContact(user.id, userId, patch);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditing(false);
      await load();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function setBlocked(on: boolean) {
    setError(null);
    try {
      if (on) await blockUser(userId);
      else await unblockUser(userId);
      void Haptics.notificationAsync(on ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }

  const groups = useMemo(() => ({
    media: (items ?? []).filter((item) => item.kind === "image" || item.kind === "video"),
    voice: (items ?? []).filter((item) => item.kind === "voice"),
    decks: (items ?? []).filter((item) => item.kind === "share" && item.share?.kind === "presentation"),
    games: (items ?? []).filter((item) => item.kind === "share" && item.share?.kind === "game"),
  }), [items]);

  if (!peer) {
    return (
      <View style={[styles.safe, styles.center]}>
        {error ? <InlineError message={error} /> : <ActivityIndicator color={colors.primary} />}
        <Back />
      </View>
    );
  }

  const display = peerName(peer);
  const stats: CardStat[] = [
    { key: "decks", value: formatNumber(peer.decks ?? 0), label: t("profile:stats.decks"), glyph: <Layers color="#FFFFFF" size={18} strokeWidth={2.2} /> },
    { key: "games", value: formatNumber(peer.games ?? 0), label: t("profile:stats.games"), glyph: <Gamepad2 color="#FFFFFF" size={18} strokeWidth={2.2} /> },
    { key: "shared", value: formatNumber(items?.length ?? 0), label: t("sharedStat"), glyph: <FolderOpen color="#FFFFFF" size={18} strokeWidth={2.2} /> },
  ];
  const actions: CardAction[] = [
    { key: "send", label: t("profile.send"), glyph: ArrowUpRight, onPress: () => router.push({ pathname: "/(app)/coins/send", params: { to: peer.id } }) },
    {
      key: "share", label: t("profile.share"), glyph: Share2,
      onPress: () => void Share.share({ message: t("profile.shareText", { name: display, url: `${APP_URL}${peer.username ? `  @${peer.username}` : ""}` }) }),
    },
    { key: "edit", label: peer.saved ? t("profile.edit") : t("profile.save"), glyph: peer.saved ? Pencil : UserPlus, onPress: () => setEditing((value) => !value) },
    { key: "mute", label: peer.muted ? t("profile.unmute") : t("profile.mute"), glyph: peer.muted ? Bell : BellOff, onPress: () => void contact({ muted: !peer.muted }) },
  ];
  const ActiveIcon = TABS.find((entry) => entry.key === tab)!.icon;

  return (
    <View style={styles.safe}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 10) + 6, paddingBottom: insets.bottom + spacing.xxl }]}
      >
        <Glow uri={peer.avatar_url} />
        <ProfileHeroCard
          size="large"
          onBack={() => router.back()}
          scrollY={scrollY}
          name={display}
          handle={peer.username ? `@${peer.username}` : ""}
          bio={peer.bio}
          study={peer.study ?? ""}
          avatarUrl={peer.avatar_url}
          initials={display.replace(/^@/, "").split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase()}
          tier="free"
          planName={null}
          decks={0}
          games={0}
          coins={0}
          badge={false}
          stats={stats}
          actions={actions}
        />

        {editing ? (
          <Animated.View entering={FadeInDown.duration(65)} style={[styles.panel, styles.editor]}>
            <Text style={styles.label}>{t("profile.contactName")}</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={t("profile.contactPlaceholder")} placeholderTextColor={colors.inkSoft} maxLength={80} autoFocus />
            <PrimaryButton label={t("profile.save")} loading={busy} onPress={() => void contact({ display_name: name.trim() || null })} />
          </Animated.View>
        ) : null}
        {/* Whether they are here — never shown between two people one of whom blocked the other. */}
        {!peer.blocked && (peer.online || peer.last_seen_at) ? (
          <Animated.Text entering={FadeIn.delay(75).duration(75)} style={[styles.presence, peer.online && styles.presenceOn]}>
            {peer.online ? t("online") : lastSeen(peer.last_seen_at!, (key, options) => String(t(key as never, options as never)))}
          </Animated.Text>
        ) : null}
        {peer.muted ? <Text style={styles.muted}>{t("profile.muted")}</Text> : null}
        {error ? <View style={{ paddingHorizontal: spacing.xl }}><InlineError message={error} /></View> : null}

        {conversation ? (
          <Animated.View entering={FadeInDown.delay(112).duration(95)} style={styles.panel}>
            {/* Four tabs, icon over word like the card's own buttons; a count
                rides on the icon of each that has something in it. */}
            <View style={styles.tabs}>
              {TABS.map(({ key, icon: Icon }) => {
                const active = tab === key;
                const count = groups[key].length;
                return (
                  <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }}
                    onPress={() => { setTab(key); void Haptics.selectionAsync(); }} style={[styles.tab, active && styles.tabActive]}>
                    <View>
                      <Icon color={active ? colors.primary : colors.inkMuted} size={21} strokeWidth={2.1} />
                      {count ? (
                        <View style={[styles.count, active && styles.countActive]}>
                          <Text style={styles.countText}>{count > 99 ? "99+" : count}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                      {t(`tabs.${key}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!items ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.xl }} />
              : groups[tab].length === 0 ? (
                <Animated.View key={tab} entering={FadeIn.duration(110)} style={styles.emptyBox}>
                  <View style={styles.emptyIcon}><ActiveIcon color={colors.primary} size={26} strokeWidth={2} /></View>
                  <Text style={styles.empty}>{t("tabEmpty")}</Text>
                </Animated.View>
              )
              : tab === "media" ? <MediaGrid items={groups.media} conversation={conversation} peerId={userId} />
              : tab === "voice" ? (
                <View style={styles.list}>
                  {/* Up to three hundred: the newest twenty are fetched ahead, the rest when tapped. */}
                  {groups.voice.map((item, index) => (
                    <View key={item.id} style={styles.voiceRow}>
                      <VoiceMessage message={item} mine={false} prefetch={index < VOICE_AHEAD} />
                      <Text style={styles.when}>{item.sender_id === user?.id ? t("you").trim().replace(/:$/, "") : display} · {chatListTime(item.created_at)}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.list}>
                  {groups[tab].map((item) => <SharedRow key={item.id} item={item} mine={item.sender_id === user?.id} />)}
                </View>
              )}
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeIn.delay(130).duration(80)}>
          <Pressable
            accessibilityRole="button"
            onPress={() => (peer.blocked ? void setBlocked(false) : setAskBlock(true))}
            style={({ pressed }) => [styles.blockRow, pressed && { opacity: 0.8 }]}
          >
            <Ban color={peer.blocked ? colors.primary : colors.danger} size={20} strokeWidth={2.2} />
            <Text style={[styles.blockText, { color: peer.blocked ? colors.primary : colors.danger }]}>
              {peer.blocked ? t("block.unblock") : t("block.block")}
            </Text>
          </Pressable>
        </Animated.View>
      </Animated.ScrollView>
      <ActionSheet
        visible={askBlock}
        onClose={() => setAskBlock(false)}
        cancelLabel={t("cancel")}
        title={t("block.confirmTitle", { name: display })}
        message={t("block.confirmBody")}
        actions={[{ key: "block", label: t("block.block"), icon: Ban, destructive: true, onPress: () => void setBlocked(true) }]}
      />
    </View>
  );
}

/** An album's picture is listed as `<message id>:<n>`: the message it belongs to. */
const messageOf = (id: string) => id.split(":")[0] ?? id;
/** A fresh value for each ask, so the same picture asked for twice is answered twice. */
const askedNow = () => String(Date.now());

function MediaGrid({ items, conversation, peerId }: { items: ChatMessage[]; conversation: string | null; peerId: string }) {
  const styles = useStyles();
  const router = useRouter();
  const { width } = useWindowDimensions();
  // The panel's inner width: the screen less its edges, the panel's padding and rim.
  const size = Math.floor((Math.min(width, 560) - EDGE * 2 - PANEL_PAD * 2 - 2 - GRID_GAP * 2) / 3);
  const [open, setOpen] = useState<ChatMessage | null>(null);
  const pictures = items.filter((item) => item.kind === "image");
  // Back to the conversation, at the picture's message — to see it there, or to answer it.
  const toChat = (index: number, key: "focus" | "reply") => {
    const item = pictures[index];
    if (!conversation || !item) return;
    router.dismissTo({ pathname: "/(app)/chat/[id]", params: { id: conversation, peer: peerId, [key]: messageOf(item.id), at: askedNow() } });
  };
  return (
    <>
      <View style={styles.grid}>
        {items.map((item) => <MediaTile key={item.id} item={item} size={size} onPress={() => setOpen(item)} />)}
      </View>
      {open?.kind === "image" ? (
        <PictureViewer
          pictures={pictures.map((item) => ({ path: item.media_path, local: null, width: item.media.width ?? 4, height: item.media.height ?? 3 }))}
          start={Math.max(0, pictures.findIndex((item) => item.id === open.id))}
          onClose={() => setOpen(null)}
          onShowInChat={conversation ? (index) => toChat(index, "focus") : undefined}
          onReply={conversation ? (index) => toChat(index, "reply") : undefined}
        />
      ) : (
        <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
          <Pressable style={styles.viewer} onPress={() => setOpen(null)}>
            {open ? <Viewer item={open} /> : null}
          </Pressable>
        </Modal>
      )}
    </>
  );
}

function MediaTile({ item, size, onPress }: { item: ChatMessage; size: number; onPress: () => void }) {
  const styles = useStyles();
  // A picture's tile shows the picture; a video message's shows its length only — nothing of it is fetched for that.
  const url = usePath(item.kind === "image" ? item.media_path : null);
  return (
    <Pressable onPress={onPress} style={[styles.tile, { width: size, height: size }]}>
      {item.kind === "image" && url ? <Image source={{ uri: url }} style={{ width: size, height: size }} resizeMode="cover" /> : null}
      {item.kind === "video" ? (
        <View style={styles.tileVideo}>
          <Play color="#fff" size={26} fill="#fff" />
          <Text style={styles.tileLength}>{mediaLength(item.media.duration_ms ?? 0)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Viewer({ item }: { item: ChatMessage }) {
  const styles = useStyles();
  const url = usePath(item.kind === "image" ? item.media_path : null);
  // A video message plays from the files on the phone (fetched at once if need be), every part it was recorded in.
  if (item.kind === "video") return <VideoNote message={item} />;
  if (!url) return <ActivityIndicator color="#fff" />;
  return <Image source={{ uri: url }} style={styles.viewerImage} resizeMode="contain" />;
}

function SharedRow({ item, mine }: { item: ChatMessage; mine: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const share = item.share!;
  const Icon = share.kind === "game" ? Gamepad2 : Presentation;
  async function add() {
    setBusy(true);
    try {
      const added = await addToLibrary(item.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push(libraryHref(added.kind, added.id) as never);
    } catch (failure) {
      Alert.alert(t("addToLibrary"), asErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.shared}>
      <View style={styles.sharedIcon}><Icon color={colors.primary} size={24} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.sharedTitle} numberOfLines={2}>{share.title}</Text>
        <Text style={styles.when}>{share.kind === "presentation" ? `${t("withDefense")} · ` : ""}{chatListTime(item.created_at)}</Text>
      </View>
      {mine
        ? <Pressable onPress={() => router.push(libraryHref(share.kind, share.id) as never)} style={styles.sharedButton}><Text style={styles.sharedButtonText}>{t("open")}</Text></Pressable>
        : (
          <Pressable accessibilityLabel={t("addToLibrary")} disabled={busy} onPress={() => void add()} style={[styles.sharedButton, styles.sharedButtonPrimary]}>
            {busy ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <LibraryBig color={colors.onPrimary} size={19} />}
          </Pressable>
        )}
    </View>
  );
}

const PANEL_PAD = 10;
const GRID_GAP = 4;

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", justifyContent: "center" },
  content: { overflow: "visible" },
  back: {
    position: "absolute", left: spacing.lg, width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  // One sheet under the card, as wide as it: the tabs and what they hold.
  panel: {
    marginHorizontal: EDGE, marginTop: 14, padding: PANEL_PAD, gap: PANEL_PAD, borderRadius: 30,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    shadowColor: "#2A0F55", shadowOpacity: 0.1, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 3,
  },
  editor: { padding: spacing.lg, gap: spacing.md },
  label: { ...typography.bodyMedium, color: colors.ink },
  input: { ...typography.body, fontSize: 16, color: colors.ink, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 14 },
  muted: { ...typography.caption, fontSize: 13, color: colors.inkMuted, textAlign: "center", marginTop: spacing.md },
  presence: { ...typography.caption, fontSize: 13.5, color: colors.inkMuted, textAlign: "center", marginTop: spacing.md },
  presenceOn: { color: colors.primary, fontFamily: "JaxongirmanSans_700Bold" },
  blockRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginHorizontal: EDGE, marginTop: 14,
    minHeight: 54, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  blockText: { ...typography.bodyMedium },
  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 22, backgroundColor: colors.surfaceMuted },
  // Sized by its word and then sharing what is left, so the long one is never cut.
  tab: { flexGrow: 1, flexShrink: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 10, paddingBottom: 8, paddingHorizontal: 6, borderRadius: 18 },
  tabActive: { backgroundColor: colors.surface, shadowColor: "#2A0F55", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  tabText: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 12.5, lineHeight: 16, color: colors.inkMuted },
  tabTextActive: { color: colors.primaryDeep },
  count: {
    position: "absolute", top: -7, left: 14, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.inkSoft, borderWidth: 2, borderColor: colors.surfaceMuted,
  },
  countActive: { backgroundColor: colors.primary, borderColor: colors.surface },
  countText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 10, lineHeight: 12, color: "#FFFFFF" },
  emptyBox: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxl },
  emptyIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  empty: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  list: { gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  tile: { backgroundColor: colors.surfaceMuted, overflow: "hidden", borderRadius: 14 },
  tileVideo: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#1E1236" },
  tileLength: { position: "absolute", left: 8, bottom: 7, fontFamily: "JaxongirmanSans_700Bold", fontSize: 11.5, color: "#fff" },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  viewerImage: { width: "100%", height: "86%" },
  voiceRow: { gap: 6, padding: spacing.md, borderRadius: 20, backgroundColor: colors.surfaceMuted },
  when: { ...typography.caption, fontSize: 12.5, color: colors.inkMuted },
  shared: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: 20, backgroundColor: colors.surfaceMuted },
  sharedIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  sharedTitle: { ...typography.bodyMedium, fontSize: 16, lineHeight: 21, color: colors.ink },
  sharedButton: { minWidth: 48, height: 44, paddingHorizontal: spacing.md, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  sharedButtonPrimary: { backgroundColor: colors.primary },
  sharedButtonText: { ...typography.caption, fontSize: 13, fontFamily: "JaxongirmanSans_700Bold", color: colors.primaryDeep },
}));
