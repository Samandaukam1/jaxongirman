import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ChevronRight, CreditCard, Crown, Gamepad2, LogOut, Moon, Pencil, Receipt, Store, Sun, SunMoon,
  Trash2, User as UserIcon, Wallet,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import coinIcon from "../../../assets/coin/coin-icon.png";
/**
 * The slide stack from Loyihalar, and it has to be that one.
 *
 * "Taqdimot" here counts the same thing that screen makes, so drawing it with a
 * different icon would be the app disagreeing with itself about what a
 * presentation looks like. The file numbers do not run in the order of the
 * sheet they were cut from — `4.svg` is the stack — which is why the import is
 * named for the picture rather than the digit.
 */
import SlideCreateArt from "../../../assets/icons/4.svg";
import { AccentIcon } from "@/components/AccentIcon";
import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { DeleteAccountSheet } from "@/components/DeleteAccountSheet";
import { SegmentedSwitch, type Segment } from "@/components/SegmentedSwitch";
import { Touchable } from "@/components/Touchable";
import { asErrorMessage } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { myMembership } from "@/lib/subscription";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import type { ThemeMode } from "@/theme/ThemeProvider";
import { brandInk, gradients, icon, radius, shadow, spacing, typography, type AccentName } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Identity = {
  firstName: string;
  lastName: string;
  username: string;
  bio: string;
  organization: string;
  fieldOfStudy: string;
};

const EMPTY: Identity = {
  firstName: "", lastName: "", username: "", bio: "", organization: "", fieldOfStudy: "",
};

/**
 * How big the picture of you is.
 *
 * It used to be 116 inside a 128 ring, which sounds close to this and is not:
 * the ring was a translucent white square and the whole block sat under a page
 * of padding, so the picture read as a thumbnail attached to a header. At 120
 * on a lit plate, high on the screen, it is the subject of the screen. The ring
 * is the difference between the two numbers and is drawn as a gradient, so the
 * edge of the photograph is a lit rim rather than a border somebody drew.
 */
const AVATAR = 120;
const RING = 8;

/** The header actions, and the hue each one is drawn in. */
const HERO_ACTIONS = [
  { key: "tarif", label: "Tarif", glyph: Crown, accent: "gold", href: "/(app)/tarif" },
  { key: "shop", label: "Do‘kon", glyph: Store, accent: "magenta", href: "/(app)/marketplace/seller" },
  { key: "edit", label: "Tahrirlash", glyph: Pencil, accent: "azure", href: "/(app)/profile-edit" },
] as const satisfies readonly { key: string; label: string; glyph: typeof Crown; accent: AccentName; href: string }[];

/** Sozlamalar, one hue each, in the order somebody reaches for them. */
const SETTINGS = [
  { label: "Tarif", detail: "Obuna va limitlaringiz", glyph: Crown, accent: "gold", href: "/(app)/tarif" },
  { label: "Mahsulotlarim", detail: "Do‘konga qo‘yganlaringiz", glyph: Store, accent: "magenta", href: "/(app)/marketplace/seller" },
  { label: "Daromadlar", detail: "Sotuvlar va to‘lovlar", glyph: Wallet, accent: "emerald", href: "/(app)/earnings" },
  { label: "To‘lovlar tarixi", detail: "Buyurtmalar va cheklar", glyph: Receipt, accent: "azure", href: "/(app)/orders" },
  { label: "Chala kartalar", detail: "To‘lovda ishlatilgan kartalar", glyph: CreditCard, accent: "indigo", href: "/(app)/cards" },
] as const satisfies readonly { label: string; detail: string; glyph: typeof Crown; accent: AccentName; href: string }[];

const APPEARANCE: readonly Segment<ThemeMode>[] = [
  { key: "system", label: "Tizim", icon: SunMoon },
  { key: "light", label: "Yorug‘", icon: Sun },
  { key: "dark", label: "Qorong‘i", icon: Moon },
];

/**
 * The profile, as something you have rather than something you fill in.
 *
 * This tab used to be the edit form. Every visit — to check a balance, to open
 * the tariff, to sign out — opened a page of text inputs with a Save button
 * under them, for a task nobody had come to do. The form now lives on its own
 * screen and this one answers the question people actually arrive with: who am
 * I here, what am I on, and what have I made.
 *
 * The second thing it had wrong was colour. Eleven controls, every one of them
 * the same violet outline at the same weight, which is a screen you navigate by
 * counting rows. The glyphs are unchanged; what changed is that each now sits
 * on a plate of its own hue (`AccentIcon`), and the two counts that name things
 * the app already draws elsewhere — a presentation, a J Tanga — use the
 * drawings the app already draws them with rather than a second opinion.
 */
export default function ProfileScreen() {
  const { colors, mode, setMode } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [identity, setIdentity] = useState<Identity>(EMPTY);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [credits, setCredits] = useState(0);
  const [plan, setPlan] = useState<string | null>(null);
  const [counts, setCounts] = useState({ presentations: 0, games: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);

    /**
     * Counted by the server, not fetched and measured here.
     *
     * `head: true` with an exact count returns the number and no rows, which is
     * the difference between reading "12" and downloading twelve decks to find
     * out there are twelve.
     */
    const [profileResult, walletResult, membership, decks, games] = await Promise.all([
      supabase.from("profiles")
        .select("first_name,last_name,username,bio,avatar_url,organization,field_of_study")
        .eq("id", user.id).single(),
      supabase.from("credit_wallets").select("balance").eq("user_id", user.id).single(),
      myMembership().catch(() => null),
      supabase.from("presentations").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
      supabase.from("games").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
    ]);

    if (profileResult.error) setError(asErrorMessage(profileResult.error));
    else {
      setIdentity({
        firstName: profileResult.data.first_name ?? "",
        lastName: profileResult.data.last_name ?? "",
        username: profileResult.data.username ?? "",
        bio: profileResult.data.bio ?? "",
        organization: profileResult.data.organization ?? "",
        fieldOfStudy: profileResult.data.field_of_study ?? "",
      });
      setAvatarUrl(profileResult.data.avatar_url);
      setError(null);
    }
    if (!walletResult.error) setCredits(walletResult.data.balance);
    setPlan(membership?.member ? membership.planName : null);
    setCounts({ presentations: decks.count ?? 0, games: games.count ?? 0 });
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  // Re-read on focus, so a name changed on the edit screen is already right
  // when the person comes back rather than one pull-to-refresh later.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const fullName = [identity.firstName, identity.lastName].filter(Boolean).join(" ");
  const initials = [identity.firstName, identity.lastName]
    .map((part) => part.trim()[0] ?? "")
    .join("")
    .toUpperCase();

  const stats = [
    { key: "decks", value: counts.presentations, label: "Taqdimot", accent: "violet" as AccentName, art: SlideCreateArt },
    { key: "games", value: counts.games, label: "O‘yin", accent: "teal" as AccentName, glyph: Gamepad2 },
    { key: "coins", value: credits, label: "J Tanga", accent: "gold" as AccentName, image: coinIcon },
  ];

  if (loading) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        {/**
          * The header is one object: a coloured field with the person in it.
          *
          * The top inset is measured rather than guessed at. The old number was
          * 72 on iOS and 44 elsewhere, which on a phone with a Dynamic Island
          * left a band of empty violet under the island and on one without it
          * pushed the picture down for no reason. Asking the device puts the
          * avatar as close to the top as the hardware allows on every one of
          * them, and the actions sit under the name where nothing they do can
          * reach the island's territory.
          */}
        <LinearGradient
          colors={gradients.hero}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[styles.hero, { paddingTop: Math.max(insets.top, 24) + spacing.sm }]}
        >
          <View style={styles.avatarLift}>
            <LinearGradient
              colors={["rgba(255,255,255,0.98)", "rgba(255,255,255,0.42)"]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={styles.avatarRing}
            >
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.avatar}
                  // Cover, stated: a portrait squeezed to fit a square is the
                  // one way a profile picture can be actively wrong.
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.avatar, styles.avatarEmpty]}>
                  {initials
                    ? <Text style={styles.initials}>{initials}</Text>
                    : <UserIcon color={brandInk.strong} size={48} strokeWidth={1.5} />}
                </LinearGradient>
              )}
            </LinearGradient>
          </View>

          <View style={styles.heroCopy}>
            <Text style={styles.name} numberOfLines={1}>{fullName || "Ismingizni kiriting"}</Text>
            <View style={styles.heroMeta}>
              <Text style={styles.handle} numberOfLines={1}>
                {identity.username ? `@${identity.username}` : user?.email}
              </Text>
              {plan ? (
                <View style={styles.planChip}>
                  {/* The plate is white in both themes, so its glyph takes the
                      ink that belongs to the plate. `primaryDeep` lightens at
                      night by design — on this chip that made the crown a pale
                      violet mark on white, next to text that had stayed dark. */}
                  <Crown color={brandInk.onPlate} size={12} strokeWidth={2.4} />
                  <Text style={styles.planText} numberOfLines={1}>{plan}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.heroActions}>
            {HERO_ACTIONS.map((action) => (
              <Touchable
                key={action.key}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => router.push(action.href)}
                style={styles.heroAction}
              >
                <AccentIcon accent={action.accent} glyph={action.glyph} size={50} />
                <Text style={styles.heroActionLabel} numberOfLines={1}>{action.label}</Text>
              </Touchable>
            ))}
          </View>
        </LinearGradient>

        {/* Overlapping the field above, so the two read as one header. */}
        <View style={styles.stats}>
          {stats.map((stat, at) => (
            <View key={stat.key} style={styles.statCell}>
              {at > 0 ? <View style={styles.statRule} /> : null}
              <AccentIcon accent={stat.accent} glyph={stat.glyph} art={stat.art} image={stat.image} size={40} />
              {/**
                * One line, shrunk rather than wrapped.
                *
                * A balance is six digits long more often than it is not, and a
                * six-digit figure that wraps takes the label under it off the
                * card. `adjustsFontSizeToFit` keeps three columns on one
                * baseline whatever is in them.
                */}
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {formatNumber(stat.value)}
              </Text>
              <Text style={styles.statLabel} numberOfLines={1}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {identity.organization || identity.fieldOfStudy || identity.bio ? (
          <View style={styles.about}>
            {identity.organization || identity.fieldOfStudy ? (
              <Text style={styles.study} numberOfLines={2}>
                {[identity.organization, identity.fieldOfStudy].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
            {identity.bio ? <Text style={styles.bio}>{identity.bio}</Text> : null}
          </View>
        ) : null}

        {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

        {/**
          * Which palette the app draws in.
          *
          * Three choices rather than two: "Tizim" is the default and the one
          * most people never change — a phone that goes dark at sunset should
          * take the app with it. The other two exist because some people want
          * one or the other regardless, and an app that overrules them is an
          * app they fight. Remembered on the device, because it is a property
          * of the screen you are holding.
          */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>KO‘RINISH</Text>
          <SegmentedSwitch options={APPEARANCE} value={mode} onChange={setMode} />
        </View>

        {/* Sozlamalar: the marketplace surfaces a person owns. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SOZLAMALAR</Text>
          <View style={styles.rows}>
            {SETTINGS.map((row) => (
              <Touchable
                key={row.href}
                accessibilityRole="button"
                accessibilityLabel={row.label}
                onPress={() => router.push(row.href)}
                style={styles.row}
              >
                <AccentIcon accent={row.accent} glyph={row.glyph} size={42} />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{row.label}</Text>
                  <Text style={styles.rowDetail} numberOfLines={1}>{row.detail}</Text>
                </View>
                <ChevronRight color={colors.inkSoft} size={18} strokeWidth={2.2} />
              </Touchable>
            ))}
          </View>
        </View>

        {/**
          * Leaving, and ending.
          *
          * Two different things, so they are two different weights: signing out
          * is reversible and reads as an ordinary button, deletion is not and
          * reads as the only red thing on the screen. They are separated by
          * their own heading rather than sitting at the end of the settings
          * list, because a permanent action should never be the row after
          * "Chala kartalar" — that is a place a thumb arrives at by scrolling.
          */}
        <View style={styles.section}>
          <Touchable
            accessibilityRole="button"
            onPress={() => void signOut().catch((signOutError) => Alert.alert("Xatolik", asErrorMessage(signOutError)))}
            style={styles.signOut}
          >
            <LogOut color={colors.inkMuted} size={icon.sm} strokeWidth={icon.stroke} />
            <Text style={styles.signOutText}>Hisobdan chiqish</Text>
          </Touchable>

          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Accountni o‘chirish"
            onPress={() => setConfirmingDelete(true)}
            style={styles.danger}
          >
            <Trash2 color={colors.onPrimary} size={icon.sm} strokeWidth={2.2} />
            <Text style={styles.dangerText}>O‘CHIRISH</Text>
          </Touchable>
          <Text style={styles.dangerNote}>
            Accountni o‘chirish — hisobingiz va shaxsiy ma’lumotlaringiz butunlay o‘chiriladi.
          </Text>
        </View>
      </ScrollView>

      <DeleteAccountSheet visible={confirmingDelete} onClose={() => setConfirmingDelete(false)} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  // The hero bleeds to the edges, so padding moves onto the sections below it.
  content: { paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.lg },
  hero: {
    paddingHorizontal: spacing.xl,
    // Room for the stats card, which sits over the last of it.
    paddingBottom: spacing.xl + 40,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    alignItems: "center",
    gap: spacing.md,
  },
  // The lift lives outside the ring, because a shadow on a view that clips its
  // children is a shadow that is clipped with them.
  avatarLift: {
    borderRadius: (AVATAR + RING * 2) * 0.36,
    shadowColor: "#1A0736",
    shadowOpacity: 0.34,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  avatarRing: {
    width: AVATAR + RING * 2,
    height: AVATAR + RING * 2,
    borderRadius: (AVATAR + RING * 2) * 0.36,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR * 0.34, backgroundColor: colors.surfaceMuted },
  avatarEmpty: { alignItems: "center", justifyContent: "center" },
  initials: { fontFamily: "Manrope_700Bold", fontSize: 42, color: brandInk.strong, letterSpacing: 1 },
  heroCopy: { alignItems: "center", gap: 4, maxWidth: "100%" },
  name: { ...typography.title, color: brandInk.strong, textAlign: "center" },
  heroMeta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, flexWrap: "wrap" },
  handle: { ...typography.body, color: brandInk.muted, flexShrink: 1 },
  planChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: brandInk.plate, maxWidth: 160 },
  planText: { ...typography.caption, fontWeight: "700", color: brandInk.onPlate, flexShrink: 1 },
  /**
   * Three actions that fit whatever the phone is.
   *
   * Fixed widths and a fixed gap add up to 276 points, which is fine until the
   * phone is 320 wide and the row is 272 — at which point the last button is
   * simply off the side of the screen, on exactly the devices nobody tests on.
   * Sharing the row instead means the arithmetic cannot come out wrong, and the
   * cap stops the buttons drifting apart on a Max.
   */
  heroActions: { flexDirection: "row", justifyContent: "center", alignSelf: "stretch", gap: spacing.md, marginTop: spacing.xs },
  heroAction: { flex: 1, maxWidth: 96, alignItems: "center", gap: 6 },
  heroActionLabel: { ...typography.caption, color: brandInk.muted, textAlign: "center" },
  stats: {
    flexDirection: "row",
    alignItems: "stretch",
    // Lifted onto the gradient, which is what makes the two one header.
    marginTop: -40,
    marginHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  statCell: { flex: 1, alignItems: "center", gap: 6, paddingHorizontal: spacing.xs },
  // A hairline between columns rather than three boxed cards: the divider is
  // what makes them read as one panel of three figures.
  statRule: { position: "absolute", left: 0, top: 6, bottom: 6, width: 1, backgroundColor: colors.border },
  statValue: { fontFamily: "Manrope_700Bold", fontSize: 19, lineHeight: 24, color: colors.ink, letterSpacing: -0.4 },
  statLabel: { ...typography.caption, color: colors.inkMuted },
  about: { paddingHorizontal: spacing.xl, gap: 4 },
  study: { ...typography.caption, color: colors.inkMuted },
  bio: { ...typography.body, color: colors.ink },
  errorBox: { marginHorizontal: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  errorText: { ...typography.caption, color: colors.danger },
  section: { marginHorizontal: spacing.xl, gap: spacing.sm },
  sectionTitle: { ...typography.caption, fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.1, color: colors.inkSoft, marginLeft: spacing.xs },
  rows: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  rowCopy: { flex: 1, gap: 1 },
  rowLabel: { ...typography.bodyMedium, color: colors.ink, fontSize: 15 },
  rowDetail: { ...typography.caption, fontSize: 11.5, color: colors.inkSoft },
  signOut: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    height: 50, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  signOutText: { ...typography.bodyMedium, color: colors.inkMuted },
  danger: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    height: 52, borderRadius: radius.md,
    backgroundColor: colors.danger,
    marginTop: spacing.xs,
  },
  dangerText: { ...typography.bodyMedium, fontFamily: "Manrope_700Bold", color: colors.onPrimary, letterSpacing: 0.8 },
  dangerNote: { ...typography.caption, color: colors.inkSoft, textAlign: "center", paddingHorizontal: spacing.md },
}));
