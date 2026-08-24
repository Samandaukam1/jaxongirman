import { useLocalSearchParams, useRouter } from "expo-router";
import * as ScreenCapture from "expo-screen-capture";
import { ChevronLeft, ShieldAlert } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Dimensions, FlatList, Image, Pressable, Text, View } from "react-native";

import { signPaths } from "@/lib/marketplace";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

/**
 * Looking at a product before buying it.
 *
 * What is shown here is the seller's preview images from `marketplace-previews`
 * — never the file being sold. That is not a rule this screen keeps: signed-in
 * clients hold no read policy on the `marketplace-files` bucket at all, so the
 * original has no URL to leak from here even if this code asked for one.
 *
 * The watermark carries the viewer's own account, so a screenshot that travels
 * says whose screen it left. Screenshots cannot be prevented everywhere — iOS
 * allows recording protection but not stills — so the platform's own guard is
 * turned on where it exists and the watermark covers the rest. Neither is
 * treated as a wall; together they make a leak attributable, which is what is
 * actually achievable.
 */
export default function ProductPreviewScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = String(id ?? "");

  const [images, setImages] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // Android blocks the screenshot outright; iOS blocks recording and leaves
    // stills alone. Both are best-effort by design, and the call is harmless
    // where the platform does nothing with it.
    void ScreenCapture.preventScreenCaptureAsync().catch(() => undefined);
    return () => { void ScreenCapture.allowScreenCaptureAsync().catch(() => undefined); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.rpc("marketplace_product_detail", { p_product_id: productId });
      if (cancelled || !data) { setLoading(false); return; }

      const detail = data as unknown as {
        product: { title: string; cover_path: string | null };
        previews: { path: string }[];
      };
      const paths = [detail.product.cover_path, ...detail.previews.map((preview) => preview.path)]
        .filter((path): path is string => Boolean(path));
      const signed = paths.length > 0 ? await signPaths("marketplace-previews", paths) : {};

      if (cancelled) return;
      setTitle(detail.product.title);
      setImages(paths.map((path) => signed[path]).filter((url): url is string => Boolean(url)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [productId]);

  /**
   * The mark itself: who is looking, and when.
   *
   * Repeated across the frame rather than placed once, because one mark in a
   * corner is one crop away from gone.
   */
  const stamp = useMemo(() => {
    const who = user?.email ?? user?.id?.slice(0, 8) ?? "mehmon";
    return `${who} · ${new Date().toLocaleDateString("uz-UZ")}`;
  }, [user]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Orqaga" onPress={() => router.back()} style={styles.back}>
          <ChevronLeft color="#fff" size={icon.lg} strokeWidth={2} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.counter}>{images.length > 0 ? `${index + 1}/${images.length}` : ""}</Text>
      </View>

      {loading ? (
        <View style={styles.centre}><ActivityIndicator color="#fff" /></View>
      ) : images.length === 0 ? (
        <View style={styles.centre}>
          <Text style={styles.emptyText}>Bu mahsulot uchun ko‘rish uchun rasm qo‘yilmagan.</Text>
        </View>
      ) : (
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(uri, position) => `${position}-${uri.slice(-24)}`}
          onMomentumScrollEnd={(event) =>
            setIndex(Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
          renderItem={({ item }) => (
            <View style={styles.page}>
              <Image source={{ uri: item }} style={styles.image} resizeMode="contain" />
              {/* Drawn over the image rather than into it: burning a mark into
                  the asset would mean re-encoding every seller's upload, and a
                  stored copy that is watermarked for nobody in particular. */}
              <View pointerEvents="none" style={styles.watermarkLayer}>
                {Array.from({ length: 9 }, (_, row) => (
                  <Text key={row} style={styles.watermark} numberOfLines={1}>
                    {`${stamp}    ${stamp}    ${stamp}`}
                  </Text>
                ))}
              </View>
            </View>
          )}
        />
      )}

      <View style={styles.footer}>
        <ShieldAlert color={colors.accentSoft} size={icon.sm} strokeWidth={2} />
        <Text style={styles.footerText}>
          Ko‘rish rejimi — yuklab olish va ulashish yopiq. Xarid qilgach, fayl to‘liq sizniki bo‘ladi.
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: "#0B0814" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: 52, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  back: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  headerTitle: { ...typography.bodyMedium, color: "#fff", flex: 1 },
  counter: { ...typography.caption, color: "rgba(255,255,255,0.6)" },

  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyText: { ...typography.body, color: "rgba(255,255,255,0.66)", textAlign: "center" },

  page: { width: SCREEN_WIDTH, flex: 1, alignItems: "center", justifyContent: "center" },
  image: { width: SCREEN_WIDTH - spacing.lg * 2, height: "82%", borderRadius: radius.md },
  watermarkLayer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, justifyContent: "space-evenly", transform: [{ rotate: "-24deg" }] },
  watermark: { color: "rgba(255,255,255,0.16)", fontSize: 13, fontFamily: "Manrope_600SemiBold" },

  footer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, paddingBottom: 34 },
  footerText: { ...typography.caption, color: "rgba(255,255,255,0.6)", flex: 1, lineHeight: 17 },
}));
