import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ChevronRight, CircleHelp, CreditCard, Crown, Inbox, Languages, LogOut, MessageSquarePlus, MonitorSmartphone, Moon, Pencil, Receipt, ShieldCheck, Store, Sun, SunMoon,
  Trash2, User as UserIcon, Wallet, type LucideIcon,
} from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Image, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { BrandSurface } from "@/components/BrandSurface";
import { DeleteAccountSheet } from "@/components/DeleteAccountSheet";
import { MarathonProfileCard } from "@/components/MarathonProfileCard";
import { PlanUsageCard } from "@/components/PlanUsageCard";
import { SegmentedSwitch, type Segment } from "@/components/SegmentedSwitch";
import { Touchable } from "@/components/Touchable";
import { asErrorMessage } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { myMembership } from "@/lib/subscription";
import { supabase } from "@/lib/supabase";
import { supportUnread } from "@/lib/support";
import { LANGUAGE_NAMES, type AppLanguage } from "@/i18n";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import type { ThemeMode } from "@/theme/ThemeProvider";
import { brandInk, gradients, radius, shadow, spacing, typography } from "@/theme/tokens";
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
 * The picture of you, and the rim of page colour round it.
 *
 * The rim is the canvas, not white: it is what cuts the photograph out of the
 * banner it overlaps, so at night it has to be the night's colour too.
 */
const AVATAR = 106;
const RING = 5;
const FRAME = AVATAR + RING * 2;

/** Sozlamalar, in the order somebody reaches for them. The only way to the tariff on this screen. */
const SETTINGS = [
  { key: "tariff", glyph: Crown, href: "/(app)/tarif" },
  { key: "products", glyph: Store, href: "/(app)/marketplace/seller" },
  { key: "earnings", glyph: Wallet, href: "/(app)/earnings" },
  { key: "orders", glyph: Receipt, href: "/(app)/orders" },
  { key: "cards", glyph: CreditCard, href: "/(app)/cards" },
  // The site, signed in with this phone: scan the code it shows.
  { key: "web", glyph: MonitorSmartphone, href: "/(app)/web-login" },
  // Where the account is signed in, and taking a device out.
  { key: "devices", glyph: ShieldCheck, href: "/(app)/devices" },
] as const satisfies readonly { key: string; glyph: LucideIcon; href: string }[];

/** Yordam markazi: a question to the support staff, the questions already asked, and the common answers. */
const SUPPORT = [
  { key: "new", glyph: MessageSquarePlus, href: "/(app)/support/new" },
  { key: "mine", glyph: Inbox, href: "/(app)/support" },
  { key: "faq", glyph: CircleHelp, href: "/(app)/support?faq=1" },
] as const satisfies readonly { key: string; glyph: LucideIcon; href: string }[];

const APPEARANCE_ICONS = { system: SunMoon, light: Sun, dark: Moon } as const;

/**
 * The profile, as something you have rather than something you fill in.
 *
 * This tab used to be the edit form; the form now lives on its own screen and
 * this one answers what people arrive with: who am I here, what am I on, what
 * have I made.
 *
 * The version before this one spent colour everywhere — a violet field bled
 * from the top of the screen, three action tiles each in their own hue, a hue
 * per settings row, a red slab at the bottom — and read as busy rather than
 * finished. Now the brand is one banner (`BrandSurface`, the same material as
 * the balance card on Bosh sahifa), the person sits on its edge, and every
 * control below is drawn one way: one tile, one ink, one grouped list. The
 * only other colour is red, on the one thing that cannot be undone. The tariff
 * is reached from one row; a member's allowance shows above the settings.
 */
export default function ProfileScreen() {
  const { colors, mode, setMode } = useTheme();
  const { t } = useTranslation(["profile", "common"]);
  const { language, setLanguage, uiLanguages } = useLanguage();
  const appearance = useMemo<Segment<ThemeMode>[]>(
    () => (Object.keys(APPEARANCE_ICONS) as ThemeMode[]).map((key) => ({ key, label: t(`appearance.${key}`), icon: APPEARANCE_ICONS[key] })),
    [t],
  );
  // Each language named in itself, never translated: someone lost in the wrong one must still find theirs.
  // The languages the operator offers, and always the one in use.
  const languages = useMemo<Segment<AppLanguage>[]>(
    () => uiLanguages.concat(uiLanguages.includes(language) ? [] : [language])
      .map((code) => ({ key: code, label: LANGUAGE_NAMES[code], icon: Languages })),
    [language, uiLanguages],
  );
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [identity, setIdentity] = useState<Identity>(EMPTY);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [credits, setCredits] = useState(0);
  const [plan, setPlan] = useState<string | null>(null);
  const [member, setMember] = useState(false);
  const [counts, setCounts] = useState({ presentations: 0, games: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportBadge, setSupportBadge] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /**
   * Only the first visit waits behind a spinner.
   *
   * Every focus re-reads, and it used to set `loading` each time — which swapped
   * the whole screen for a spinner and mounted it again on every return to the
   * tab. The figures are already on screen by then; they are updated in place.
   */
  const loaded = useRef(false);
  const load = useCallback(async (isRefresh = false) => {
    if (!user) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true); else if (!loaded.current) setLoading(true);

    /**
     * Counted by the server, not fetched and measured here.
     *
     * `head: true` with an exact count returns the number and no rows, which is
     * the difference between reading "12" and downloading twelve decks to find
     * out there are twelve.
     */
    try {
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
      setMember(Boolean(membership?.member));
      setCounts({ presentations: decks.count ?? 0, games: games.count ?? 0 });
    } catch (failure) {
      // A dropped connection is a line on the screen, never a screen that
      // stays a spinner or takes the tab down with it.
      setError(asErrorMessage(failure));
    } finally {
      loaded.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // Re-read on focus, so a name changed on the edit screen is already right
  // when the person comes back rather than one pull-to-refresh later.
  useFocusEffect(useCallback(() => {
    void load();
    void supportUnread().then(setSupportBadge);
  }, [load]));

  const fullName = [identity.firstName, identity.lastName].filter(Boolean).join(" ");
  const initials = [identity.firstName, identity.lastName]
    .map((part) => part.trim()[0] ?? "")
    .join("")
    .toUpperCase();

  const stats = [
    { key: "decks", value: counts.presentations, label: t("stats.decks") },
    { key: "games", value: counts.games, label: t("stats.games") },
    { key: "coins", value: credits, label: t("stats.coins") },
  ];

  if (loading) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        {/* The top inset is measured, so the banner sits under the island on
            every phone rather than at a guessed distance from it. */}
        <BrandSurface radius={28} style={[styles.banner, { marginTop: Math.max(insets.top, 24) + spacing.sm }]} />

        <View style={styles.identity}>
          {/* The lift lives outside the frame: a shadow on a view that clips its
              children is clipped with them. */}
          <View style={styles.avatarLift}>
            <View style={styles.avatarFrame}>
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
                    : <UserIcon color={brandInk.strong} size={44} strokeWidth={1.5} />}
                </LinearGradient>
              )}
            </View>
          </View>

          <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{fullName || t("namePlaceholder")}</Text>
          <View style={styles.meta}>
            <Text style={styles.handle} numberOfLines={1}>
              {identity.username ? `@${identity.username}` : user?.email}
            </Text>
            {plan ? (
              <View style={styles.planChip}>
                <Crown color={colors.primaryDeep} size={12} strokeWidth={2.4} />
                <Text style={styles.planText} numberOfLines={1}>{plan}</Text>
              </View>
            ) : null}
          </View>
          {identity.organization || identity.fieldOfStudy ? (
            <Text style={styles.study} numberOfLines={2}>
              {[identity.organization, identity.fieldOfStudy].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {identity.bio ? <Text style={styles.bio}>{identity.bio}</Text> : null}

          <Touchable
            accessibilityRole="button"
            accessibilityLabel={t("edit")}
            onPress={() => router.push("/(app)/profile-edit")}
            style={styles.edit}
          >
            <Pencil color={colors.ink} size={15} strokeWidth={2.2} />
            <Text style={styles.editText}>{t("edit")}</Text>
          </Touchable>
        </View>

        {/* Three figures on one panel, divided by hairlines rather than boxed. */}
        <View style={styles.stats}>
          {stats.map((stat, at) => (
            <View key={stat.key} style={styles.statCell}>
              {at > 0 ? <View style={styles.statRule} /> : null}
              {/* One line, shrunk rather than wrapped: a balance is six digits
                  more often than not, and a wrapped figure pushes its label off. */}
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {formatNumber(stat.value)}
              </Text>
              <Text style={styles.statLabel} numberOfLines={1}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

        {/* A member's allowance and the restart. Without a plan there is nothing
            to count, and the way to one is the Tarif row below. */}
        {member ? <View style={styles.section}><PlanUsageCard /></View> : null}

        {/* Above Sozlamalar, and never inside it — see the component. */}
        <MarathonProfileCard />

        {/* "Tizim" is the default: a phone that goes dark at sunset should take
            the app with it. Remembered on the device. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("sections.appearance")}</Text>
          <SegmentedSwitch options={appearance} value={mode} onChange={setMode} />
        </View>

        {/* The app's language; a deck's own language is chosen when it is made. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("sections.language")}</Text>
          <SegmentedSwitch options={languages} value={language} onChange={(next) => void setLanguage(next)} />
        </View>

        {/* Above Sozlamalar: somebody with a problem should not have to look for it. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("sections.support")}</Text>
          <View style={styles.group}>
            <View style={styles.groupClip}>
              {SUPPORT.map((row, at) => (
                <Pressable
                  key={row.href}
                  accessibilityRole="button"
                  accessibilityLabel={t(`support.${row.key}.label`)}
                  onPress={() => router.push(row.href)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  {at > 0 ? <View style={styles.rowRule} /> : null}
                  <Tile glyph={row.glyph} />
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{t(`support.${row.key}.label`)}</Text>
                    <Text style={styles.rowDetail} numberOfLines={1}>{t(`support.${row.key}.detail`)}</Text>
                  </View>
                  {row.href === "/(app)/support" && supportBadge > 0 ? (
                    <View style={styles.supportBadge}><Text style={styles.supportBadgeText}>{supportBadge}</Text></View>
                  ) : null}
                  <ChevronRight color={colors.inkSoft} size={18} strokeWidth={2.2} />
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("sections.settings")}</Text>
          <View style={styles.group}>
            <View style={styles.groupClip}>
              {SETTINGS.filter((row) => row.key !== "web" || Platform.OS !== "web").map((row, at) => (
                <Pressable
                  key={row.href}
                  accessibilityRole="button"
                  accessibilityLabel={t(`settings.${row.key}.label`)}
                  onPress={() => router.push(row.href)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  {at > 0 ? <View style={styles.rowRule} /> : null}
                  <Tile glyph={row.glyph} />
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{t(`settings.${row.key}.label`)}</Text>
                    <Text style={styles.rowDetail} numberOfLines={1}>{t(`settings.${row.key}.detail`)}</Text>
                  </View>
                  <ChevronRight color={colors.inkSoft} size={18} strokeWidth={2.2} />
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/**
          * Leaving, and ending.
          *
          * Their own group under their own heading, never the row after "Chala
          * kartalar" — that is where a thumb arrives by scrolling. Signing out is
          * reversible and drawn like any row; deleting is not, and is the only
          * red on the screen. The row opens a sheet; the sheet does the deleting.
          */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("sections.account")}</Text>
          <View style={styles.group}>
            <View style={styles.groupClip}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void signOut().catch((signOutError) => Alert.alert(t("common:error"), asErrorMessage(signOutError)))}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Tile glyph={LogOut} tone="plain" />
                <View style={styles.rowCopy}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{t("signOut")}</Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("deleteAccount")}
                onPress={() => setConfirmingDelete(true)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.rowRule} />
                <Tile glyph={Trash2} tone="danger" />
                <View style={styles.rowCopy}>
                  <Text style={[styles.rowLabel, styles.dangerLabel]} numberOfLines={1}>{t("deleteAccount")}</Text>
                  <Text style={styles.rowDetail} numberOfLines={2}>{t("deleteDetail")}</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      <DeleteAccountSheet visible={confirmingDelete} onClose={() => setConfirmingDelete(false)} />
    </View>
  );
}

/** A row's glyph on its tile. Every row draws it the same way; only deletion is red. */
function Tile({ glyph: Glyph, tone = "brand" }: { glyph: LucideIcon; tone?: "brand" | "plain" | "danger" }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const ground = tone === "danger" ? colors.dangerSoft : tone === "plain" ? colors.surfaceMuted : colors.primarySoft;
  const ink = tone === "danger" ? colors.danger : tone === "plain" ? colors.inkMuted : colors.primary;
  return (
    <View style={[styles.tile, { backgroundColor: ground }]}>
      <Glyph color={ink} size={18} strokeWidth={2} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  content: { paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.lg },
  banner: { height: 148, marginHorizontal: spacing.lg },
  // Half the picture over the banner; the content's own gap is taken back too.
  identity: { alignItems: "center", marginTop: -(FRAME / 2) - spacing.lg, paddingHorizontal: spacing.xl },
  avatarLift: {
    borderRadius: FRAME * 0.345,
    backgroundColor: colors.canvas,
    shadowColor: "#1A0736",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  avatarFrame: {
    width: FRAME,
    height: FRAME,
    padding: RING,
    borderRadius: FRAME * 0.345,
    backgroundColor: colors.canvas,
  },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR * 0.33, backgroundColor: colors.surfaceMuted },
  avatarEmpty: { alignItems: "center", justifyContent: "center" },
  initials: { fontFamily: "Manrope_700Bold", fontSize: 38, color: brandInk.strong, letterSpacing: 1 },
  name: { ...typography.title, color: colors.ink, textAlign: "center", marginTop: spacing.md, maxWidth: "100%" },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: 2, maxWidth: "100%" },
  handle: { ...typography.body, color: colors.inkMuted, flexShrink: 1 },
  planChip: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft, maxWidth: 160,
  },
  planText: { ...typography.caption, fontFamily: "Manrope_700Bold", fontSize: 11.5, color: colors.primaryDeep, flexShrink: 1 },
  study: { ...typography.caption, color: colors.inkSoft, textAlign: "center", marginTop: spacing.sm },
  bio: { ...typography.body, fontSize: 14.5, color: colors.inkMuted, textAlign: "center", marginTop: spacing.sm },
  edit: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 42, paddingHorizontal: spacing.xl - 4,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface,
    marginTop: spacing.lg,
  },
  editText: { ...typography.bodyMedium, fontSize: 14, color: colors.ink },
  stats: {
    flexDirection: "row",
    alignItems: "stretch",
    marginHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  statCell: { flex: 1, alignItems: "center", gap: 2, paddingHorizontal: spacing.sm },
  statRule: { position: "absolute", left: 0, top: 6, bottom: 6, width: 1, backgroundColor: colors.border },
  statValue: { fontFamily: "Manrope_800ExtraBold", fontSize: 22, lineHeight: 28, color: colors.ink, letterSpacing: -0.5 },
  statLabel: { ...typography.caption, color: colors.inkMuted },
  errorBox: { marginHorizontal: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  errorText: { ...typography.caption, color: colors.danger },
  section: { marginHorizontal: spacing.xl, gap: spacing.sm },
  sectionTitle: { ...typography.caption, fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.1, color: colors.inkSoft, marginLeft: spacing.xs },
  // The shadow on the outer view, the clipping on the inner: one view cannot do both on iOS.
  group: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow },
  groupClip: { borderRadius: radius.lg - 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.md, minHeight: 62 },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  // Inset to the text, as a grouped list draws it: the tiles stand in one column.
  rowRule: { position: "absolute", left: 64, right: 0, top: 0, height: 1, backgroundColor: colors.border },
  tile: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, gap: 1 },
  rowLabel: { ...typography.bodyMedium, color: colors.ink, fontSize: 15 },
  supportBadge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  supportBadgeText: { ...typography.caption, fontSize: 11, fontFamily: "Manrope_700Bold", color: colors.onPrimary },
  rowDetail: { ...typography.caption, fontSize: 11.5, color: colors.inkSoft },
  dangerLabel: { color: colors.danger },
}));
