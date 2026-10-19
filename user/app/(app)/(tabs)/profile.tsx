import { useRouter } from "expo-router";
import {
  ChevronRight, CircleHelp, CreditCard, Crown, Inbox, Languages, LogOut, MessageSquarePlus, MonitorSmartphone, Moon, Receipt, ShieldCheck, Store, Sun, SunMoon,
  Trash2, Wallet, type LucideIcon,
} from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, Share, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { DeleteAccountSheet } from "@/components/DeleteAccountSheet";
import { ProfileHeroCard } from "@/components/ProfileHeroCard";
import { MarathonProfileCard } from "@/components/MarathonProfileCard";
import { PlanUsageCard } from "@/components/PlanUsageCard";
import { SegmentedSwitch, type Segment } from "@/components/SegmentedSwitch";
import { useFocusRefresh } from "@/lib/useFocusRefresh";
import { asErrorMessage } from "@/lib/format";
import { myMembership } from "@/lib/subscription";
import { supabase } from "@/lib/supabase";
import { supportUnread } from "@/lib/support";
import { tierOf } from "@/lib/tier";
import { LANGUAGE_NAMES, type AppLanguage } from "@/i18n";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import type { ThemeMode } from "@/theme/ThemeProvider";
import { radius, shadow, spacing, typography } from "@/theme/tokens";
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
 * finished. The person is now one portrait card at the top
 * (`ProfileHeroCard`) — their photograph, framed in the metal of their plan —
 * and every control below is drawn one way: one tile, one ink, one grouped
 * list. The only other colour is red, on the one thing that cannot be undone.
 * The tariff is reached from one row; a member's allowance shows above the
 * settings.
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
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [member, setMember] = useState(false);
  const [counts, setCounts] = useState({ presentations: 0, games: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportBadge, setSupportBadge] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Read by the card: pulling past the top stretches it.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => { scrollY.value = event.contentOffset.y; });

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
      setPlanCode(membership?.member ? membership.planCode : null);
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
  useFocusRefresh(useCallback(() => {
    void load();
    void supportUnread().then(setSupportBadge);
  }, [load]));

  const fullName = [identity.firstName, identity.lastName].filter(Boolean).join(" ");
  const initials = [identity.firstName, identity.lastName]
    .map((part) => part.trim()[0] ?? "")
    .join("")
    .toUpperCase();


  if (loading) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        {/* The top inset is measured, so the card sits under the island on
            every phone rather than at a guessed distance from it. */}
        <View style={{ marginTop: Math.max(insets.top, 24) + spacing.sm }}>
          <ProfileHeroCard
            name={fullName || t("namePlaceholder")}
            handle={identity.username ? `@${identity.username}` : user?.email ?? ""}
            bio={identity.bio}
            study={[identity.organization, identity.fieldOfStudy].filter(Boolean).join(" · ")}
            avatarUrl={avatarUrl}
            initials={initials}
            tier={tierOf(planCode, member)}
            planName={plan}
            decks={counts.presentations}
            games={counts.games}
            coins={credits}
            onEdit={() => router.push("/(app)/profile-edit")}
            onSend={() => router.push("/(app)/coins/send")}
            onTopUp={() => router.push("/(app)/coins/buy")}
            scrollY={scrollY}
            onShare={() => {
              const message = identity.username
                ? t("actions.shareMessage", { username: identity.username })
                : t("actions.shareMessagePlain");
              void Share.share({ message }).catch(() => undefined);
            }}
          />
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
      </Animated.ScrollView>

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
