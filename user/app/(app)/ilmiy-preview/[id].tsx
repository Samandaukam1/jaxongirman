import * as Font from "expo-font";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ZoomIn, ZoomOut } from "lucide-react-native";
import { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Image, Platform, Pressable, ScrollView, Text, View, useWindowDimensions, type ViewToken } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState } from "@/components/StateBlocks";
import { previewWork, type Preview, type PreviewItem } from "@/lib/academic";
import { asErrorMessage } from "@/lib/format";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The A4 preview of a scientific work: the pages exactly as the PDF sets them.
 *
 * The server lays the document out once — the same layout the PDF is drawn
 * from — and sends every word with its place on its page. This screen only
 * puts each word there, in Tinos, the face the PDF embeds (Times New Roman's
 * metrics), so a line breaks here where it breaks in the file and the page
 * the person approves is the page they download.
 */

const TINOS = "https://unpkg.com/@expo-google-fonts/tinos@0.4.2";
const FACES = {
  Tinos_400Regular: `${TINOS}/400Regular/Tinos_400Regular.ttf`,
  Tinos_700Bold: `${TINOS}/700Bold/Tinos_700Bold.ttf`,
  Tinos_400Regular_Italic: `${TINOS}/400Regular_Italic/Tinos_400Regular_Italic.ttf`,
  Tinos_700Bold_Italic: `${TINOS}/700Bold_Italic/Tinos_700Bold_Italic.ttf`,
} as const;
/** Tinos's ascent as a share of its size: where the baseline sits below a line's top. */
const ASCENT = 0.891;

function useTinos(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    Font.loadAsync(FACES).then(() => alive && setReady(true)).catch(() => alive && setReady(false));
    return () => { alive = false; };
  }, []);
  return ready;
}

const family = (flags: number, tinos: boolean) => {
  if (!tinos) return Platform.select({ ios: "Times New Roman", default: "serif" });
  return flags === 3 ? "Tinos_700Bold_Italic" : flags === 1 ? "Tinos_700Bold" : flags === 2 ? "Tinos_400Regular_Italic" : "Tinos_400Regular";
};

const Page = memo(function Page({ items, scale, width, height, pictures, tinos }: {
  items: PreviewItem[];
  scale: number;
  width: number;
  height: number;
  pictures: (string | null)[];
  tinos: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.page, { width: width * scale, height: height * scale }]}>
      {items.map((item, at) => {
        if (item[0] === "b") {
          const [, x, y, w, h] = item;
          return <View key={at} style={[styles.rule, { left: x * scale, top: y * scale, width: w * scale, height: h * scale }]} />;
        }
        if (item[0] === "i") {
          const [, x, y, w, h, index] = item;
          const uri = pictures[index];
          return uri
            ? <Image key={at} source={{ uri }} style={{ position: "absolute", left: x * scale, top: y * scale, width: w * scale, height: h * scale }} resizeMode="contain" />
            : <View key={at} style={[styles.missing, { left: x * scale, top: y * scale, width: w * scale, height: h * scale }]} />;
        }
        const [x, y, size, flags, text] = item;
        return (
          <Text
            key={at}
            numberOfLines={1}
            allowFontScaling={false}
            style={[styles.word, {
              left: x * scale,
              top: (y - size * ASCENT) * scale,
              fontSize: size * scale,
              fontFamily: family(flags, tinos),
            }]}
          >
            {text}
          </Text>
        );
      })}
    </View>
  );
});

export default function AcademicPreviewScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tools");
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width: screen } = useWindowDimensions();
  const tinos = useTinos();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [current, setCurrent] = useState(1);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try { setPreview(await previewWork(id)); }
    catch (failure) { setError(asErrorMessage(failure)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // Stable for the list's whole life: a FlatList refuses a new viewability callback.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setCurrent(first.index + 1);
  }, []);

  const fit = preview ? (Math.min(screen, 820) - spacing.lg * 2) / preview.width : 1;
  const scale = fit * (zoomed ? 1.8 : 1);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t("academic.previewTitle")}
        subtitle={preview ? t("academic.pageOf", { page: current, total: preview.pages.length }) : undefined}
        onLeave={() => router.back()}
        action={preview ? (
          <Pressable accessibilityLabel={zoomed ? t("academic.zoomOut") : t("academic.zoomIn")} onPress={() => setZoomed((value) => !value)} style={styles.zoom}>
            {zoomed ? <ZoomOut color={colors.primary} size={20} /> : <ZoomIn color={colors.primary} size={20} />}
          </Pressable>
        ) : undefined}
      />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!preview && !error || tinos === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.wait}>{t("academic.previewLoading")}</Text>
        </View>
      ) : null}
      {preview && tinos !== null ? (
        <ScrollView horizontal={zoomed} scrollEnabled={zoomed} contentContainerStyle={{ flexGrow: 1 }} showsHorizontalScrollIndicator={zoomed}>
          <FlatList
            data={preview.pages}
            keyExtractor={(_, index) => String(index)}
            contentContainerStyle={styles.pages}
            initialNumToRender={2}
            windowSize={3}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 40 }}
            renderItem={({ item }) => (
              <Page items={item} scale={scale} width={preview.width} height={preview.height} pictures={preview.pictures} tinos={tinos} />
            )}
          />
        </ScrollView>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.surfaceMuted },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  wait: { ...typography.caption, color: colors.inkMuted },
  zoom: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  pages: { padding: spacing.lg, gap: spacing.lg, alignItems: "center" },
  // Paper is white in both themes: it is a picture of a printed page.
  page: {
    backgroundColor: "#FFFFFF", overflow: "hidden", borderRadius: 2,
    shadowColor: "#1B0B3A", shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  word: { position: "absolute", color: "#111111", includeFontPadding: false, padding: 0, margin: 0 },
  rule: { position: "absolute", borderWidth: 0.75, borderColor: "#111111" },
  missing: { position: "absolute", backgroundColor: "#EEEEEE", borderRadius: radius.sm },
}));
