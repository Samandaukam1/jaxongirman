import { NOTIFICATION_FALLBACK_ROUTES, type NotificationKind, type Tables } from "@jaxongirman/types";
import { useRouter, type Href } from "expo-router";
import {
  Bell, CalendarDays, CheckCheck, ClipboardCheck, ClipboardList, Gift, Layers, Send,
  ShieldAlert, Sparkles, Store, Timer, Wallet, X, type LucideIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, shadow, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Notification = Tables<"notifications">;

/** How far back the date strip reaches. */
const CALENDAR_DAYS = 30;

function dayKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const WEEKDAYS = ["Yak", "Du", "Se", "Cho", "Pay", "Ju", "Sha"];
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

function longDate(date: Date): string {
  const today = dayKey(new Date());
  if (dayKey(date) === today) return "Bugun";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(date) === dayKey(yesterday)) return "Kecha";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function clockTime(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * The glyph for each kind of message. A kind the client has not been taught
 * about still renders — with the neutral icon — rather than breaking the row.
 */
const KIND_ICONS: Record<string, LucideIcon> = {
  credit_gift: Gift,
  credit_received: Wallet,
  credit_sent: Send,
  survey_invite: ClipboardList,
  survey_deadline: Timer,
  survey_completed: ClipboardCheck,
  project_ready: Layers,
  presentation: Sparkles,
  marketplace_sale: Store,
  marketplace_purchase: Store,
  subscription_expiry: ShieldAlert,
  system: Sparkles,
};

/** Coin arrivals are the only kind that celebrates; everything else just opens. */
const CELEBRATED: readonly string[] = ["credit_gift", "credit_received"];

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { user } = useAuth();
  const { setUnreadCount } = useAccount();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ amount: number; message: string } | null>(null);
  const listRef = useRef<FlatList<Notification>>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const { data, error: requestError } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (requestError) setError(asErrorMessage(requestError));
    else { setError(null); setItems(data); }
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  // A gift granted while this screen is open should appear without a pull.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notifications-inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => setItems((rows) => [payload.new as Notification, ...rows]))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user]);

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: CALENDAR_DAYS }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - index);
      return date;
    });
  }, []);

  const countsByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(dayKey(item.created_at), (counts.get(dayKey(item.created_at)) ?? 0) + 1);
    return counts;
  }, [items]);

  const visible = useMemo(
    () => (selectedDay ? items.filter((item) => dayKey(item.created_at) === selectedDay) : items),
    [items, selectedDay],
  );
  const unread = items.filter((item) => !item.read_at).length;

  async function open(item: Notification) {
    if (!item.read_at) {
      setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row));
      setUnreadCount(Math.max(items.filter((row) => !row.read_at).length - 1, 0));
      const { error: readError } = await supabase.rpc("mark_notifications_read", { p_id: item.id });
      if (readError) setError(asErrorMessage(readError));
    }

    if (CELEBRATED.includes(item.kind)) {
      const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload) ? item.payload : {};
      setCelebration({ amount: Number((payload as { amount?: number }).amount ?? 0), message: item.body });
      return;
    }

    // The row's own deep_link wins; the kind is only a fallback for messages
    // written before the column existed. Both are in-app paths — the column's
    // check constraint refuses anything absolute, so this cannot open the web.
    const target = item.deep_link ?? NOTIFICATION_FALLBACK_ROUTES[item.kind as NotificationKind];
    if (target) router.push(target as Href);
  }

  async function markAll() {
    setItems((rows) => rows.map((row) => row.read_at ? row : { ...row, read_at: new Date().toISOString() }));
    setUnreadCount(0);
    const { error: readError } = await supabase.rpc("mark_notifications_read", {});
    if (readError) setError(asErrorMessage(readError));
  }

  function pickDay(date: Date) {
    const key = dayKey(date);
    setSelectedDay((current) => (current === key ? null : key));
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Xabarnomalar</Text>
          <Text style={styles.subtitle}>{unread ? `${unread} ta o‘qilmagan xabar` : "Barchasi o‘qilgan"}</Text>
        </View>
        {unread > 0 ? (
          <Pressable accessibilityLabel="Barchasini o‘qilgan deb belgilash" onPress={() => void markAll()} style={styles.headerButton}>
            <CheckCheck color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
          </Pressable>
        ) : null}
        {/* Always reachable, whatever the list is doing underneath. */}
        <Pressable accessibilityLabel="Yopish" onPress={() => router.back()} style={styles.headerButton}>
          <X color={colors.ink} size={icon.md} strokeWidth={icon.strokeBold} />
        </Pressable>
      </View>

      <View style={styles.calendarBlock}>
        <View style={styles.calendarLabel}>
          <CalendarDays color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} />
          <Text style={styles.calendarLabelText}>
            {selectedDay ? `${longDate(new Date(selectedDay))} — ${visible.length} ta xabar` : "Kunni tanlang"}
          </Text>
          {selectedDay ? (
            <Pressable onPress={() => setSelectedDay(null)} style={styles.clearChip}>
              <Text style={styles.clearChipText}>Barchasi</Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.calendarStrip}>
          {days.map((date) => {
            const key = dayKey(date);
            const active = selectedDay === key;
            const count = countsByDay.get(key) ?? 0;
            return (
              <Pressable key={key} onPress={() => pickDay(date)} style={[styles.dayChip, active && styles.dayChipActive]}>
                <Text style={[styles.dayName, active && styles.dayTextActive]}>{WEEKDAYS[date.getDay()]}</Text>
                <Text style={[styles.dayNumber, active && styles.dayTextActive]}>{date.getDate()}</Text>
                <View style={[styles.dayDot, count > 0 && styles.dayDotFilled, active && styles.dayDotActive]} />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={visible}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Bell color={colors.inkSoft} size={34} strokeWidth={1.6} />
              <Text style={styles.emptyTitle}>{selectedDay ? "Bu kunda xabar yo‘q" : "Hozircha xabar yo‘q"}</Text>
              <Text style={styles.emptyCopy}>Tanga, so‘rovnoma va tizim xabarlari shu yerda ko‘rinadi.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const gift = CELEBRATED.includes(item.kind);
            const Glyph = KIND_ICONS[item.kind] ?? Sparkles;
            return (
              <Pressable onPress={() => void open(item)} style={[styles.row, !item.read_at && styles.rowUnread]}>
                <View style={styles.rowCopy}>
                  <View style={styles.rowTop}>
                    {!item.read_at ? <View style={styles.unreadDot} /> : null}
                    <Text numberOfLines={2} style={[styles.rowTitle, !item.read_at && styles.rowTitleUnread]}>{item.title}</Text>
                  </View>
                  {item.body ? <Text numberOfLines={3} style={styles.rowBody}>{item.body}</Text> : null}
                  <Text style={styles.rowMeta}>{longDate(new Date(item.created_at))} · {clockTime(item.created_at)}</Text>
                </View>
                <View style={[styles.rowIcon, gift && styles.rowIconGift]}>
                  <Glyph color={gift ? colors.onPrimary : colors.primary} size={22} strokeWidth={1.9} />
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {celebration ? (
        <CelebrationOverlay amount={celebration.amount} message={celebration.message} onClose={() => setCelebration(null)} />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingTop: Platform.OS === "ios" ? 58 : 30, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerCopy: { flex: 1 },
  title: { ...typography.title, color: colors.ink },
  subtitle: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  headerButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  calendarBlock: { paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  calendarLabel: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  calendarLabelText: { ...typography.caption, color: colors.inkMuted, flex: 1 },
  clearChip: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  clearChipText: { ...typography.caption, color: colors.primary },
  calendarStrip: { paddingHorizontal: spacing.xl, gap: spacing.sm, flexDirection: "row-reverse" },
  dayChip: { width: 52, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: "center", gap: 2, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayName: { fontFamily: "Manrope_500Medium", fontSize: 10, color: colors.inkSoft },
  dayNumber: { fontFamily: "Manrope_700Bold", fontSize: 16, color: colors.ink },
  dayTextActive: { color: colors.onPrimary },
  dayDot: { width: 5, height: 5, borderRadius: 3, marginTop: 2, backgroundColor: "transparent" },
  dayDotFilled: { backgroundColor: colors.primary },
  dayDotActive: { backgroundColor: colors.onPrimary },
  list: { padding: spacing.xl, gap: spacing.md, paddingBottom: 60 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow },
  rowUnread: { borderColor: colors.accentSoft, backgroundColor: colors.surface },
  rowCopy: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  rowTitle: { ...typography.bodyMedium, color: colors.inkMuted, flex: 1 },
  rowTitleUnread: { color: colors.ink },
  rowBody: { ...typography.caption, color: colors.inkMuted, marginTop: 4, lineHeight: 18 },
  rowMeta: { ...typography.caption, color: colors.inkSoft, marginTop: 6 },
  rowIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft, ...shadowLifted },
  rowIconGift: { backgroundColor: colors.primary },
  centered: { paddingTop: 70, alignItems: "center", gap: spacing.sm },
  emptyTitle: { ...typography.bodyMedium, color: colors.ink, marginTop: spacing.sm },
  emptyCopy: { ...typography.caption, color: colors.inkMuted, textAlign: "center", maxWidth: 260 },
  error: { ...typography.caption, color: colors.danger, paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
}));
