import { useFocusEffect, useRouter } from "expo-router";
import { ChevronRight, CreditCard, Crown, LogOut, Receipt, Store, User as UserIcon, Wallet } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { asErrorMessage } from "@/lib/format";
import { myMembership } from "@/lib/subscription";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

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
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        <Text style={styles.pageTitle}>Profil</Text>

        <View style={styles.identity}>
          <View style={styles.avatarWrap}>
            {avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarEmpty]}><UserIcon color={colors.primary} size={38} strokeWidth={1.7} /></View>}
          </View>
          <View style={styles.identityCopy}>
            <Text style={styles.name} numberOfLines={2}>{fullName || "Ismingizni kiriting"}</Text>
            <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
            {identity.username ? <Text style={styles.handle}>@{identity.username}</Text> : null}
            {plan ? (
              <View style={styles.planChip}>
                <Crown color={colors.primaryDeep} size={13} strokeWidth={2.2} />
                <Text style={styles.planText}>{plan}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {identity.organization || identity.fieldOfStudy ? (
          <Text style={styles.study} numberOfLines={2}>
            {[identity.organization, identity.fieldOfStudy].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        {identity.bio ? <Text style={styles.bio}>{identity.bio}</Text> : null}

        {/* What this account has actually made, which is the number people
            come to this screen to see. */}
        <View style={styles.stats}>
          {[
            { value: counts.presentations, label: counts.presentations === 1 ? "taqdimot" : "taqdimot" },
            { value: counts.games, label: "o‘yin" },
            { value: credits, label: "tanga" },
          ].map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(app)/profile-edit")}
          style={styles.editButton}
        >
          <Text style={styles.editText}>Profilni tahrirlash</Text>
        </Pressable>

        {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  content: { padding: spacing.xl, paddingTop: Platform.OS === "ios" ? 66 : 38, paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.lg },
  pageTitle: { ...typography.display, color: colors.ink },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  avatarWrap: { width: 92, height: 92 },
  avatar: { width: 92, height: 92, borderRadius: 30 },
  avatarEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  identityCopy: { flex: 1, gap: 3 },
  name: { ...typography.heading, color: colors.ink },
  email: { ...typography.caption, color: colors.inkMuted },
  handle: { ...typography.caption, color: colors.inkSoft },
  planChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, marginTop: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  planText: { ...typography.caption, fontWeight: "700", color: colors.primaryDeep },
  study: { ...typography.caption, color: colors.inkMuted },
  bio: { ...typography.body, color: colors.ink },
  stats: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  statValue: { fontFamily: "Manrope_700Bold", fontSize: 22, color: colors.ink, letterSpacing: -0.4 },
  statLabel: { ...typography.caption, color: colors.inkMuted },
  editButton: { minHeight: 50, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow },
  editText: { ...typography.body, fontWeight: "700", color: colors.ink },
  errorBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  errorText: { ...typography.caption, color: colors.danger },
  settingsBlock: { gap: spacing.sm },
  settingsRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  settingsIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  settingsCopy: { flex: 1, gap: 1 },
  settingsLabel: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  settingsDetail: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.dangerSoft, backgroundColor: colors.surface },
  signOutText: { ...typography.bodyMedium, color: colors.danger },
});
