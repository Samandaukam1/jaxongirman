import { Download, ExternalLink, FileText, Presentation, Share2, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  createPresentationExport,
  openPresentationExport,
  releasePresentationExport,
  savePresentationExport,
  sharePresentationExport,
  type DownloadedPresentationExport,
  type PresentationExportFormat,
} from "@/lib/presentationExport";
import { asErrorMessage } from "@/lib/format";
import { icon, radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Phase = "idle" | "generating" | "downloading" | "ready" | "failed";

type Props = {
  visible: boolean;
  presentationId: string;
  presentationTitle: string;
  onClose: () => void;
};

function ProgressBar({ value }: { value: number }) {
  const styles = useStyles();
  return <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }]} /></View>;
}

export function ExportSheet({ visible, presentationId, presentationTitle, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [format, setFormat] = useState<PresentationExportFormat>("pdf");
  const [phase, setPhase] = useState<Phase>("idle");
  const [generationProgress, setGenerationProgress] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [file, setFile] = useState<DownloadedPresentationExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (visible) return;
    abort.current?.abort();
    abort.current = null;
    releasePresentationExport(file);
    setFile(null);
    setPhase("idle");
    setGenerationProgress(0);
    setDownloadProgress(0);
    setError(null);
  }, [file, visible]);

  async function start() {
    releasePresentationExport(file);
    setFile(null);
    setError(null);
    setGenerationProgress(0);
    setDownloadProgress(0);
    setPhase("generating");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await createPresentationExport(presentationId, presentationTitle, format, {
        onGenerationProgress: (value) => { setGenerationProgress(value); setPhase("generating"); },
        onDownloadProgress: (value) => { setDownloadProgress(value); setPhase("downloading"); },
      }, controller.signal);
      abort.current = null;
      setFile(result);
      setPhase("ready");
      if (Platform.OS === "web") await savePresentationExport(result);
      else await openPresentationExport(result);
    } catch (nextError) {
      abort.current = null;
      if (nextError instanceof Error && nextError.name === "AbortError") return;
      setError(asErrorMessage(nextError));
      setPhase("failed");
    }
  }

  async function perform(action: "open" | "save" | "share") {
    if (!file) return;
    try {
      if (action === "open") await openPresentationExport(file);
      else if (action === "save") await savePresentationExport(file);
      else await sharePresentationExport(file);
    } catch (nextError) {
      Alert.alert("Fayl ochilmadi", asErrorMessage(nextError));
    }
  }

  function close() {
    abort.current?.abort();
    onClose();
  }

  const busy = phase === "generating" || phase === "downloading";
  const readyLabel = format === "pdf" ? "PDF tayyor" : "PowerPoint tayyor";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View><Text style={styles.title}>Eksport</Text><Text style={styles.subtitle}>Taqdimot formatini tanlang</Text></View>
            <Pressable accessibilityLabel="Yopish" onPress={close} style={styles.close}><X color={colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} /></Pressable>
          </View>

          {phase === "idle" || phase === "failed" ? (
            <View style={styles.formats}>
              <Pressable disabled={busy} onPress={() => setFormat("pdf")} style={[styles.formatCard, format === "pdf" && styles.formatSelected]}>
                <View style={[styles.formatIcon, format === "pdf" && styles.formatIconSelected]}><FileText color={format === "pdf" ? colors.onPrimary : colors.primary} size={icon.lg} strokeWidth={icon.stroke} /></View>
                <View style={styles.formatCopy}><Text style={styles.formatTitle}>PDF</Text><Text style={styles.formatDescription}>Ko‘rish va ulashish uchun</Text></View>
                <View style={[styles.radio, format === "pdf" && styles.radioSelected]}>{format === "pdf" ? <View style={styles.radioDot} /> : null}</View>
              </Pressable>
              <Pressable disabled={busy} onPress={() => setFormat("pptx")} style={[styles.formatCard, format === "pptx" && styles.formatSelected]}>
                <View style={[styles.formatIcon, format === "pptx" && styles.formatIconSelected]}><Presentation color={format === "pptx" ? colors.onPrimary : colors.primary} size={icon.lg} strokeWidth={icon.stroke} /></View>
                <View style={styles.formatCopy}><Text style={styles.formatTitle}>PowerPoint (.pptx)</Text><Text style={styles.formatDescription}>PowerPoint’da ochish va tahrirlash uchun</Text></View>
                <View style={[styles.radio, format === "pptx" && styles.radioSelected]}>{format === "pptx" ? <View style={styles.radioDot} /> : null}</View>
              </Pressable>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable onPress={() => void start()} style={styles.primaryButton}><Download color={colors.onPrimary} size={icon.md} strokeWidth={icon.strokeBold} /><Text style={styles.primaryText}>Yuklab olish</Text></Pressable>
            </View>
          ) : null}

          {busy ? (
            <View style={styles.status}>
              <View style={styles.statusIcon}><ActivityIndicator color={colors.primary} size="large" /></View>
              <Text style={styles.statusTitle}>{phase === "generating" ? "Eksport qilinmoqda…" : "Fayl yuklab olinmoqda…"}</Text>
              <Text style={styles.statusCopy}>{format === "pdf" ? "Slaydlar PDF faylga joylanmoqda" : "Tahrirlanadigan PowerPoint tayyorlanmoqda"}</Text>
              <ProgressBar value={phase === "generating" ? generationProgress : downloadProgress} />
              <Text style={styles.percent}>{Math.round((phase === "generating" ? generationProgress : downloadProgress) * 100)}%</Text>
            </View>
          ) : null}

          {phase === "ready" && file ? (
            <View style={styles.status}>
              <View style={[styles.statusIcon, styles.successIcon]}>{format === "pdf" ? <FileText color={colors.success} size={32} strokeWidth={icon.stroke} /> : <Presentation color={colors.success} size={32} strokeWidth={icon.stroke} />}</View>
              <Text style={styles.statusTitle}>{readyLabel}</Text>
              <Text numberOfLines={1} style={styles.fileName}>{file.fileName}</Text>
              <View style={styles.actions}>
                <Pressable onPress={() => void perform("open")} style={styles.actionButton}><ExternalLink color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} /><Text style={styles.actionText}>{format === "pdf" ? "Ochish" : "PowerPoint’da ochish"}</Text></Pressable>
                <Pressable onPress={() => void perform("save")} style={styles.actionButton}><Download color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} /><Text style={styles.actionText}>Yuklab olish</Text></Pressable>
                <Pressable onPress={() => void perform("share")} style={styles.actionButton}><Share2 color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} /><Text style={styles.actionText}>Ulashish</Text></Pressable>
              </View>
              <Text style={styles.expiry}>Yuklab olish havolasi 1 soat amal qiladi.</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(21,14,36,.36)" },
  sheet: { backgroundColor: colors.canvas, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: Platform.OS === "ios" ? 36 : spacing.xl, ...shadowLifted },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xl },
  title: { ...typography.title, color: colors.ink },
  subtitle: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  formats: { gap: spacing.md },
  formatCard: { minHeight: 82, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  formatSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  formatIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  formatIconSelected: { backgroundColor: colors.primary },
  formatCopy: { flex: 1 },
  formatTitle: { ...typography.bodyMedium, color: colors.ink },
  formatDescription: { ...typography.caption, color: colors.inkMuted, marginTop: 3 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  primaryButton: { height: 54, borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  primaryText: { ...typography.bodyMedium, color: colors.onPrimary },
  error: { ...typography.caption, color: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: spacing.md },
  status: { minHeight: 300, alignItems: "center", justifyContent: "center", paddingVertical: spacing.xl },
  statusIcon: { width: 76, height: 76, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  successIcon: { backgroundColor: colors.successSoft },
  statusTitle: { ...typography.heading, color: colors.ink, textAlign: "center" },
  statusCopy: { ...typography.body, color: colors.inkMuted, textAlign: "center", marginTop: spacing.xs },
  progressTrack: { width: "100%", height: 8, borderRadius: 4, backgroundColor: colors.primarySoft, overflow: "hidden", marginTop: spacing.xl },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  percent: { ...typography.caption, color: colors.primary, marginTop: spacing.sm },
  fileName: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs, maxWidth: "90%" },
  actions: { width: "100%", gap: spacing.sm, marginTop: spacing.xl },
  actionButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  actionText: { ...typography.bodyMedium, color: colors.primary, textAlign: "center" },
  expiry: { ...typography.caption, color: colors.inkSoft, marginTop: spacing.lg },
}));

