import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ChevronRight, Coins, CreditCard, Crown, Gamepad2, LogOut, Moon, Pencil, Presentation,
  Receipt, Store, Sun, SunMoon, User as UserIcon, Wallet,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { asErrorMessage } from "@/lib/format";
import { myMembership } from "@/lib/subscription";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { brandInk, gradients, icon, radius, spacing, typography } from "@/theme/tokens";
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
 * The profile, as something you have rather than something you fill in.
 *
 * This tab used to be the edit form. Every visit — to check a balance, to open
 * the tariff, to sign out — opened a page of text inputs with a Save button
 * under them, for a task nobody had come to do. The form now lives on its own
 * screen and this one answers the question people actually arrive with: who am
 * I here, what am I on, and what have I made.
 */
export default function ProfileScreen() {
  const { colors, mode, setMode } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [identity, setIdentity] = useState<Identity>(EMPTY);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [credits, setCredits] = useState(0);
  const [plan, setPlan] = useState<string | null>(null);
  const [counts, setCounts] = useState({ presentations: 0, games: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          * A page title, an avatar, a name and a row of buttons used to be four
          * things stacked with gaps between them, which reads as a settings
          * screen. Put on a single ground with the card below overlapping its
          * edge, the same content reads as somebody's profile — and the actions
          * sit where a thumb already is rather than at the end of a scroll.
          */}
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.avatarRing}>
            {avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarEmpty]}><UserIcon color={brandInk.strong} size={44} strokeWidth={1.6} /></View>}
          </View>

          <View style={styles.heroRow}>
            <View style={styles.heroCopy}>
              <Text style={styles.name} numberOfLines={1}>{fullName || "Ismingizni kiriting"}</Text>
              <View style={styles.heroMeta}>
                <Text style={styles.email} numberOfLines={1}>
                  {identity.username ? `@${identity.username}` : user?.email}
                </Text>
                {plan ? (
                  <View style={styles.planChip}>
                    <Crown color={colors.primaryDeep} size={12} strokeWidth={2.4} />
                    <Text style={styles.planText}>{plan}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.heroActions}>
              <Pressable
                accessibilityLabel="Tarif"
                accessibilityRole="button"
                onPress={() => router.push("/(app)/tarif")}
                style={styles.circle}
              >
                <Crown color={colors.primary} size={19} strokeWidth={2} />
              </Pressable>
              <Pressable
                accessibilityLabel="Do‘kon"
                accessibilityRole="button"
                onPress={() => router.push("/(app)/marketplace/seller")}
                style={styles.circle}
              >
                <Store color={colors.primary} size={19} strokeWidth={2} />
              </Pressable>
              {/* Filled, because editing is the one thing this screen is for. */}
              <Pressable
                accessibilityLabel="Profilni tahrirlash"
                accessibilityRole="button"
                onPress={() => router.push("/(app)/profile-edit")}
                style={[styles.circle, styles.circleFilled]}
              >
                <Pencil color={brandInk.strong} size={18} strokeWidth={2.1} />
              </Pressable>
            </View>
          </View>
        </LinearGradient>

        {/* Overlapping the field above, so the two read as one header. */}
        <View style={styles.stats}>
          {[
            { key: "decks", value: counts.presentations, label: "Taqdimot", Glyph: Presentation },
            { key: "games", value: counts.games, label: "O‘yin", Glyph: Gamepad2 },
            { key: "coins", value: credits, label: "Tanga", Glyph: Coins },
          ].map((stat) => (
            <View key={stat.key} style={styles.stat}>
              <View style={styles.statIcon}><stat.Glyph color={colors.primary} size={18} strokeWidth={2} /></View>
              <View style={styles.statCopy}>
                <Text style={styles.statValue}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
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
        <View style={styles.appearance}>
          <Text style={styles.appearanceTitle}>Ko‘rinish</Text>
          <View style={styles.appearanceRow}>
            {([
              { key: "system", label: "Tizim", Glyph: SunMoon },
              { key: "light", label: "Yorug‘", Glyph: Sun },
              { key: "dark", label: "Qorong‘i", Glyph: Moon },
            ] as const).map((option) => (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === option.key }}
                onPress={() => setMode(option.key)}
                style={[styles.appearanceOption, mode === option.key && styles.appearanceOn]}
              >
                <option.Glyph
                  color={mode === option.key ? colors.onPrimary : colors.inkMuted}
                  size={17}
                  strokeWidth={2}
                />
                <Text style={[styles.appearanceLabel, mode === option.key && styles.appearanceLabelOn]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Sozlamalar: the marketplace surfaces a person owns. */}
        <View style={styles.settingsBlock}>
          {[
            { label: "Tarif", detail: "Obuna va limitlaringiz", icon: Crown, href: "/(app)/tarif" as const },
            { label: "Mahsulotlarim", detail: "Do‘konga qo‘yganlaringiz", icon: Store, href: "/(app)/marketplace/seller" as const },
            { label: "Daromadlar", detail: "Sotuvlar va to‘lovlar", icon: Wallet, href: "/(app)/earnings" as const },
            { label: "To‘lovlar tarixi", detail: "Buyurtmalar va cheklar", icon: Receipt, href: "/(app)/orders" as const },
            { label: "Chala kartalar", detail: "To‘lovda ishlatilgan kartalar", icon: CreditCard, href: "/(app)/cards" as const },
          ].map((row) => (
            <Pressable
              key={row.href}
              accessibilityRole="button"
              onPress={() => router.push(row.href)}
              style={styles.settingsRow}
            >
              <View style={styles.settingsIcon}><row.icon color={colors.primary} size={18} strokeWidth={2} /></View>
              <View style={styles.settingsCopy}>
                <Text style={styles.settingsLabel}>{row.label}</Text>
                <Text style={styles.settingsDetail}>{row.detail}</Text>
              </View>
              <ChevronRight color={colors.inkSoft} size={18} strokeWidth={2} />
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => void signOut().catch((signOutError) => Alert.alert("Xatolik", asErrorMessage(signOutError)))} style={styles.signOut}>
          <LogOut color={colors.danger} size={icon.sm} strokeWidth={icon.stroke} />
          <Text style={styles.signOutText}>Hisobdan chiqish</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  // The hero bleeds to the edges, so padding moves onto the sections below it.
  content: { paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.lg },
  hero: {
    paddingTop: Platform.OS === "ios" ? 72 : 44,
    paddingHorizontal: spacing.xl,
    // Room for the stats card, which sits over the last of it.
    paddingBottom: spacing.xl + 34,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
    alignItems: "center",
    gap: spacing.lg,
  },
  avatarRing: {
    width: 128, height: 128, borderRadius: 44,
    alignItems: "center", justifyContent: "center",
    // A ring rather than a border, so the picture keeps its own edge.
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  avatar: { width: 116, height: 116, borderRadius: 38 },
  avatarEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  heroRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, width: "100%" },
  heroCopy: { flex: 1, gap: 4 },
  name: { ...typography.heading, color: brandInk.strong },
  heroMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  email: { ...typography.caption, color: brandInk.muted },
  planChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: brandInk.plate },
  planText: { ...typography.caption, fontWeight: "700", color: brandInk.onPlate },
  heroActions: { flexDirection: "row", gap: spacing.sm },
  circle: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  // The filled one is the primary action of the header, so it takes the plate
  // treatment: a solid white disc with the pencil in brand violet.
  circleFilled: { backgroundColor: "rgba(255,255,255,0.28)" },
  stats: {
    flexDirection: "row",
    alignItems: "center",
    // Lifted onto the gradient, which is what makes the two one header.
    marginTop: -34,
    marginHorizontal: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  stat: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  statCopy: { flexShrink: 1 },
  statValue: { fontFamily: "Manrope_700Bold", fontSize: 17, color: colors.primaryDeep, letterSpacing: -0.3 },
  statLabel: { ...typography.caption, color: colors.primaryDeep, opacity: 0.72 },
  about: { paddingHorizontal: spacing.xl, gap: 4 },
  study: { ...typography.caption, color: colors.inkMuted },
  bio: { ...typography.body, color: colors.ink },
  errorBox: { marginHorizontal: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  errorText: { ...typography.caption, color: colors.danger },
  appearance: { marginHorizontal: spacing.xl, gap: spacing.sm },
  appearanceTitle: { ...typography.caption, fontWeight: "700", color: colors.inkMuted },
  appearanceRow: { flexDirection: "row", gap: spacing.sm },
  appearanceOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  appearanceOn: { backgroundColor: colors.primary },
  appearanceLabel: { ...typography.caption, fontWeight: "600", color: colors.inkMuted },
  appearanceLabelOn: { color: colors.onPrimary },
  settingsBlock: { marginHorizontal: spacing.xl, gap: spacing.sm },
  settingsRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  settingsIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  settingsCopy: { flex: 1, gap: 1 },
  settingsLabel: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  settingsDetail: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  signOut: { marginHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.dangerSoft, backgroundColor: colors.surface },
  signOutText: { ...typography.bodyMedium, color: colors.danger },
}));
