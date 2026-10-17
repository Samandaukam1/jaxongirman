import { LinearGradient } from "expo-linear-gradient";
import { usePathname, useRouter, type Href } from "expo-router";
import {
  Bell, ClipboardList, Gamepad2, House, Layers, LifeBuoy, Plus, Sparkles, Store, type LucideIcon,
} from "lucide-react-native";
import type { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import { Image, Pressable, ScrollView, Text, View } from "react-native";

import appIcon from "../../assets/icon-320.png";
import coinIcon from "../../assets/coin/coin-icon.png";
import { Avatar } from "@/components/Avatar";
import { formatNumber } from "@/lib/money";
import { useRoom } from "@/lib/useDesktop";
import { profileInitials, useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { gradients, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The app in a browser window wide enough to be a desktop.
 *
 * A side menu takes the place of the bottom bar — the same five places plus the
 * ones a phone reaches through Profil — and the pages sit in a centred column,
 * because a phone layout stretched across 1440 px puts a button's two ends a
 * head-turn apart. The editor, a running presentation and a game on the big
 * screen get the whole window and no menu.
 *
 * The navigator is always rendered in the same place in this tree, whatever the
 * width. Resizing a window must not remount it: that would throw away every
 * screen the person has open.
 */

type Width = "full" | "wide" | "page";

const SIDEBAR_WIDTH = 264;
const COLUMN: Record<Exclude<Width, "full">, number> = { wide: 1120, page: 860 };

/** Pages that need the whole window and nothing beside them. */
const FULL = [
  /^\/presentation\/[^/]+\/edit/,
  /^\/present\/(?!scan)/,
  /^\/oyingoh\/(host|play)\//,
  /^\/marketplace\/preview\//,
];

/** Pages made of grids and lists, which use the room. */
const WIDE = [
  /^\/$/, /^\/projects$/, /^\/marketplace$/, /^\/games$/,
  /^\/presentation\/[^/]+$/, /^\/survey$/, /^\/survey\/results\//, /^\/marketplace\/library/,
  /^\/marathon/, /^\/oyingoh\/results\//,
];

function widthFor(pathname: string): Width {
  if (FULL.some((pattern) => pattern.test(pathname))) return "full";
  if (WIDE.some((pattern) => pattern.test(pathname))) return "wide";
  return "page";
}

type Place = {
  key: "home" | "projects" | "store" | "games" | "profile" | "notifications" | "surveys" | "plans" | "support";
  href: Href;
  icon: LucideIcon | null;
  /** Paths that belong to this place, so it stays lit on the pages under it. */
  owns: RegExp;
};

const MAIN: Place[] = [
  { key: "home", href: "/(app)/(tabs)", icon: House, owns: /^\/$/ },
  {
    key: "projects", href: "/(app)/(tabs)/projects", icon: Layers,
    owns: /^\/(projects|presentation|generation|defense|portrait|obyektivka|ilmiy|import)(\/|$)/,
  },
  { key: "store", href: "/(app)/(tabs)/marketplace", icon: Store, owns: /^\/(marketplace|orders)(\/|$)/ },
  { key: "games", href: "/(app)/(tabs)/games", icon: Gamepad2, owns: /^\/(games|oyingoh|game-pair)(\/|$)/ },
  { key: "profile", href: "/(app)/(tabs)/profile", icon: null, owns: /^\/(profile|profile-edit|devices|cards|earnings|coins\/send)(\/|$)/ },
];

const MORE: Place[] = [
  { key: "notifications", href: "/(app)/notifications", icon: Bell, owns: /^\/notifications/ },
  { key: "surveys", href: "/(app)/survey", icon: ClipboardList, owns: /^\/survey/ },
  { key: "plans", href: "/(app)/tarif", icon: Sparkles, owns: /^\/(tarif|checkout)/ },
  { key: "support", href: "/(app)/support", icon: LifeBuoy, owns: /^\/support/ },
];

export function DesktopShell({ children }: PropsWithChildren) {
  const room = useRoom();
  const pathname = usePathname();
  const styles = useStyles();
  const width = widthFor(pathname);
  const menu = room === "desktop" && width !== "full";
  const column = room === "phone" || width === "full" ? null : COLUMN[room === "tablet" ? "page" : width];

  return (
    <View style={styles.frame}>
      {menu ? <Sidebar pathname={pathname} /> : null}
      <View style={styles.main}>
        <View style={[styles.column, column ? { maxWidth: column } : null]}>{children}</View>
      </View>
    </View>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation("nav");
  const { profile, balance, unreadCount } = useAccount();
  const { user } = useAuth();

  // The menu goes to a top-level place: whatever was opened on top is closed
  // first, so the pages do not pile up, and then the place is opened (a tab is
  // switched to, anything else opens over the tabs).
  const go = (href: Href) => {
    if (router.canDismiss()) router.dismissAll();
    router.navigate(href);
  };
  const name = [profile?.first_name, profile?.last_name].map((part) => part?.trim()).filter(Boolean).join(" ")
    || profile?.full_name?.trim() || profile?.username || user?.email || "";

  const item = (place: Place) => {
    const active = place.owns.test(pathname);
    const Icon = place.icon;
    return (
      <Pressable
        key={place.key}
        accessibilityRole="link"
        accessibilityState={{ selected: active }}
        onPress={() => go(place.href)}
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
          styles.item, active ? styles.itemActive : (hovered || pressed) && styles.itemHover,
        ]}
      >
        {Icon ? (
          <Icon color={active ? colors.primaryDeep : colors.inkMuted} size={20} strokeWidth={active ? 2.2 : 1.9} />
        ) : (
          <Avatar uri={profile?.avatar_url} initials={profileInitials(profile)} size={22} />
        )}
        <Text style={[styles.itemText, active && styles.itemTextActive]} numberOfLines={1}>{t(place.key)}</Text>
        {place.key === "notifications" && unreadCount > 0 ? (
          <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text></View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.sidebar}>
      <ScrollView contentContainerStyle={styles.sidebarScroll} showsVerticalScrollIndicator={false}>
        <Pressable style={styles.brand} accessibilityRole="link" onPress={() => go("/(app)/(tabs)")}>
          <Image source={appIcon} style={styles.brandIcon} />
          <Text style={styles.brandText}>JAXONGIRMAN</Text>
        </Pressable>

        <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/create")} style={({ pressed }) => [pressed && styles.pressed]}>
          <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.create}>
            <Plus color="#FFFFFF" size={18} strokeWidth={2.4} />
            <Text style={styles.createText}>{t("create")}</Text>
          </LinearGradient>
        </Pressable>

        <View style={styles.group}>{MAIN.map(item)}</View>

        <Text style={styles.groupLabel}>{t("more").toUpperCase()}</Text>
        <View style={styles.group}>{MORE.map(item)}</View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/(app)/coins/buy")}
          style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.wallet, hovered && styles.walletHover]}
        >
          <Image source={coinIcon} style={styles.walletCoin} resizeMode="contain" />
          <View style={styles.walletText}>
            <Text style={styles.walletLabel}>{t("balance")}</Text>
            <Text style={styles.walletAmount}>{formatNumber(balance)}</Text>
          </View>
          <Text style={styles.walletTopUp}>{t("topUp")}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="link"
          onPress={() => go("/(app)/(tabs)/profile")}
          style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.me, hovered && styles.itemHover]}
        >
          <Avatar uri={profile?.avatar_url} initials={profileInitials(profile)} size={34} />
          <View style={styles.meText}>
            <Text style={styles.meName} numberOfLines={1}>{name}</Text>
            {user?.email && user.email !== name ? <Text style={styles.meMail} numberOfLines={1}>{user.email}</Text> : null}
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  frame: { flex: 1, flexDirection: "row", backgroundColor: colors.canvas },
  main: { flex: 1, minWidth: 0 },
  column: { flex: 1, width: "100%", alignSelf: "center" },

  sidebar: {
    width: SIDEBAR_WIDTH,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.surface,
  },
  sidebarScroll: { padding: spacing.lg, gap: spacing.md },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  brandIcon: { width: 34, height: 34, borderRadius: 10 },
  brandText: { ...typography.caption, fontFamily: "Manrope_800ExtraBold", fontSize: 13, letterSpacing: 2.4, color: colors.primary },

  create: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: 46, borderRadius: radius.md, paddingHorizontal: spacing.lg,
    boxShadow: "0 10px 24px rgba(108, 52, 201, 0.28)",
  },
  createText: { ...typography.bodyMedium, fontFamily: "Manrope_700Bold", color: "#FFFFFF" },
  pressed: { opacity: 0.88 },

  group: { gap: 2 },
  groupLabel: { ...typography.caption, fontSize: 11, letterSpacing: 1.2, color: colors.inkSoft, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  item: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.sm,
  },
  itemHover: { backgroundColor: colors.surfaceMuted },
  itemActive: { backgroundColor: colors.primarySoft },
  itemText: { ...typography.bodyMedium, color: colors.inkMuted, flex: 1 },
  itemTextActive: { color: colors.primaryDeep, fontFamily: "Manrope_700Bold" },
  badge: { minWidth: 22, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  badgeText: { ...typography.caption, fontSize: 11, lineHeight: 14, color: colors.onPrimary, fontFamily: "Manrope_700Bold" },

  footer: { padding: spacing.lg, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  wallet: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft,
  },
  walletHover: { opacity: 0.9 },
  walletCoin: { width: 34, height: 34 },
  walletText: { flex: 1, minWidth: 0 },
  walletLabel: { ...typography.caption, color: colors.inkMuted },
  walletAmount: { fontFamily: "Manrope_800ExtraBold", fontSize: 22, lineHeight: 26, color: colors.ink, letterSpacing: -0.4 },
  walletTopUp: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primary },
  me: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderRadius: radius.sm },
  meText: { flex: 1, minWidth: 0 },
  meName: { ...typography.bodyMedium, color: colors.ink },
  meMail: { ...typography.caption, color: colors.inkSoft },
}));
