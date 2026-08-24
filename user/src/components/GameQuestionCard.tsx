import {
  GAME_POINT_PRESETS, GAME_TIME_LIMIT_PRESETS, GAME_TYPE_LABELS,
  type GameOption, type GameQuestionConfig, type GameQuestionType,
} from "@jaxongirman/types";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Circle, CircleDot, Copy,
  ImagePlus, Minus, Plus, RefreshCw, Square, SquareCheck, Trash2, X,
} from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Image, LayoutChangeEvent, Pressable, Text, TextInput, View } from "react-native";

import { asErrorMessage } from "@/lib/format";
import type { GameQuestion } from "@/lib/games";
import { supabase } from "@/lib/supabase";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Props = {
  question: GameQuestion;
  index: number;
  total: number;
  onSaved: (next: GameQuestion) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onRegenerate: (() => void) | null;
  regenerating: boolean;
};

/** A stable id for a freshly added option row. */
const newId = () => Crypto.randomUUID().slice(0, 8);

function publicUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from("game-assets").getPublicUrl(path).data.publicUrl;
}

/**
 * One question as a premium editable card. Collapsed it reads like a summary;
 * expanded it is the whole editor for its type — prompt, the answer key, the
 * clock, the points, the picture. Saving writes the row and hands the fresh
 * copy back up; nothing here is autosaved, so a half-typed option can't leak
 * into a live match.
 */
export function GameQuestionCard({ question, index, total, onSaved, onDelete, onDuplicate, onMove, onRegenerate, regenerating }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(question.prompt);
  const [explanation, setExplanation] = useState(question.explanation);
  const [time, setTime] = useState(question.time_limit_seconds);
  const [points, setPoints] = useState(question.base_points);
  const [config, setConfig] = useState<GameQuestionConfig>((question.config ?? {}) as GameQuestionConfig);
  const [mediaPath, setMediaPath] = useState<string | null>(question.media_path);
  const [imageBox, setImageBox] = useState({ width: 1, height: 1 });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const type = question.type as GameQuestionType;
  const noScore = type === "word_cloud" || type === "poll";
  const needsImage = type === "image_quiz" || type === "hotspot";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { data, error: saveError } = await supabase
        .from("game_questions")
        .update({
          prompt: prompt.trim(),
          explanation: explanation.trim(),
          time_limit_seconds: time,
          base_points: noScore ? 0 : points,
          media_path: mediaPath,
          config: config as never,
        })
        .eq("id", question.id)
        .select("*")
        .single();
      if (saveError) throw saveError;
      onSaved(data as GameQuestion);
      setOpen(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Kirish talab qilinadi.");
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const path = `${user.id}/${question.game_id}/${Crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage.from("game-assets").upload(path, blob, {
        contentType: asset.mimeType ?? "image/jpeg",
      });
      if (uploadError) throw uploadError;
      setMediaPath(path);
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setUploading(false);
    }
  }

  // ------------------------------------------------------- option helpers --
  const options = config.options ?? [];
  const setOptions = (next: GameOption[]) => setConfig({ ...config, options: next });

  function setOptionText(id: string, text: string) {
    setOptions(options.map((option) => option.id === id ? { ...option, text } : option));
  }
  function addOption() {
    if (options.length >= 6) return;
    setOptions([...options, { id: newId(), text: "" }]);
  }
  function removeOption(id: string) {
    if (options.length <= 2) return;
    const next = options.filter((option) => option.id !== id);
    const correct = config.correct;
    setConfig({
      ...config,
      options: next,
      correct: Array.isArray(correct) ? correct.filter((value) => value !== id)
        : correct === id ? undefined : correct,
    });
  }

  // ------------------------------------------------------------- sections --
  function renderAnswers() {
    switch (type) {
      case "single_choice":
      case "image_quiz":
        return (
          <View style={styles.block}>
            {options.map((option) => (
              <View key={option.id} style={styles.optionRow}>
                <Pressable onPress={() => setConfig({ ...config, correct: option.id })} hitSlop={8}
                  accessibilityLabel={`${option.text || "Variant"} to‘g‘ri javob`}>
                  {config.correct === option.id
                    ? <CircleDot color={colors.success} size={icon.lg} strokeWidth={icon.strokeBold} />
                    : <Circle color={colors.borderStrong} size={icon.lg} strokeWidth={icon.stroke} />}
                </Pressable>
                <TextInput style={styles.optionInput} value={option.text} maxLength={200}
                  onChangeText={(text) => setOptionText(option.id, text)} placeholder="Variant"
                  placeholderTextColor={colors.inkSoft} />
                <Pressable onPress={() => removeOption(option.id)} hitSlop={8} accessibilityLabel="Variantni o‘chirish">
                  <X color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
                </Pressable>
              </View>
            ))}
            <AddRow label="Variant qo‘shish" onPress={addOption} />
          </View>
        );
      case "multiple_choice": {
        const correct = Array.isArray(config.correct) ? config.correct : [];
        return (
          <View style={styles.block}>
            {options.map((option) => (
              <View key={option.id} style={styles.optionRow}>
                <Pressable hitSlop={8}
                  onPress={() => setConfig({
                    ...config,
                    correct: correct.includes(option.id)
                      ? correct.filter((value) => value !== option.id)
                      : [...correct, option.id],
                  })}
                  accessibilityLabel={`${option.text || "Variant"} to‘g‘ri javob`}>
                  {correct.includes(option.id)
                    ? <SquareCheck color={colors.success} size={icon.lg} strokeWidth={icon.strokeBold} />
                    : <Square color={colors.borderStrong} size={icon.lg} strokeWidth={icon.stroke} />}
                </Pressable>
                <TextInput style={styles.optionInput} value={option.text} maxLength={200}
                  onChangeText={(text) => setOptionText(option.id, text)} placeholder="Variant"
                  placeholderTextColor={colors.inkSoft} />
                <Pressable onPress={() => removeOption(option.id)} hitSlop={8} accessibilityLabel="Variantni o‘chirish">
                  <X color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
                </Pressable>
              </View>
            ))}
            <AddRow label="Variant qo‘shish" onPress={addOption} />
          </View>
        );
      }
      case "true_false":
        return (
          <View style={[styles.block, { flexDirection: "row", gap: spacing.sm }]}>
            {([true, false] as const).map((value) => (
              <Pressable key={String(value)}
                style={[styles.tfButton, config.correct === value && styles.tfButtonActive]}
                onPress={() => setConfig({ ...config, correct: value })}>
                <Text style={[styles.tfText, config.correct === value && styles.tfTextActive]}>
                  {value ? "ROST" : "YOLG‘ON"}
                </Text>
              </Pressable>
            ))}
          </View>
        );
      case "ordering": {
        const items = config.items ?? [];
        const setItems = (next: GameOption[]) =>
          setConfig({ ...config, items: next, order: next.map((item) => item.id) });
        return (
          <View style={styles.block}>
            <Text style={styles.blockHint}>Elementlarni TO‘G‘RI tartibda yozing — o‘yinda aralashtiriladi.</Text>
            {items.map((item, itemIndex) => (
              <View key={item.id} style={styles.optionRow}>
                <Text style={styles.orderBadge}>{itemIndex + 1}</Text>
                <TextInput style={styles.optionInput} value={item.text} maxLength={200}
                  onChangeText={(text) => setItems(items.map((row) => row.id === item.id ? { ...row, text } : row))}
                  placeholder="Element" placeholderTextColor={colors.inkSoft} />
                <Pressable hitSlop={8} disabled={itemIndex === 0}
                  onPress={() => {
                    const next = [...items];
                    [next[itemIndex - 1], next[itemIndex]] = [next[itemIndex]!, next[itemIndex - 1]!];
                    setItems(next);
                  }}>
                  <ArrowUp color={itemIndex === 0 ? colors.border : colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} />
                </Pressable>
                <Pressable hitSlop={8} disabled={itemIndex === items.length - 1}
                  onPress={() => {
                    const next = [...items];
                    [next[itemIndex], next[itemIndex + 1]] = [next[itemIndex + 1]!, next[itemIndex]!];
                    setItems(next);
                  }}>
                  <ArrowDown color={itemIndex === items.length - 1 ? colors.border : colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} />
                </Pressable>
                <Pressable hitSlop={8} onPress={() => { if (items.length > 2) setItems(items.filter((row) => row.id !== item.id)); }}>
                  <X color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
                </Pressable>
              </View>
            ))}
            <AddRow label="Element qo‘shish" onPress={() => { if (items.length < 6) setItems([...items, { id: newId(), text: "" }]); }} />
          </View>
        );
      }
      case "matching": {
        const left = config.left ?? [];
        const right = config.right ?? [];
        const pairs = config.pairs ?? {};
        return (
          <View style={styles.block}>
            <Text style={styles.blockHint}>Har qatorda bitta juftlik: chapi ↔ o‘ngi.</Text>
            {left.map((leftItem) => {
              const rightItem = right.find((row) => row.id === pairs[leftItem.id]);
              return (
                <View key={leftItem.id} style={styles.optionRow}>
                  <TextInput style={[styles.optionInput, { flex: 1 }]} value={leftItem.text} maxLength={120}
                    onChangeText={(text) => setConfig({
                      ...config,
                      left: left.map((row) => row.id === leftItem.id ? { ...row, text } : row),
                    })}
                    placeholder="Chap" placeholderTextColor={colors.inkSoft} />
                  <Text style={styles.pairArrow}>↔</Text>
                  <TextInput style={[styles.optionInput, { flex: 1 }]} value={rightItem?.text ?? ""} maxLength={120}
                    onChangeText={(text) => setConfig({
                      ...config,
                      right: right.map((row) => row.id === rightItem?.id ? { ...row, text } : row),
                    })}
                    placeholder="O‘ng" placeholderTextColor={colors.inkSoft} />
                  <Pressable hitSlop={8} onPress={() => {
                    if (left.length <= 2) return;
                    const nextPairs = { ...pairs };
                    delete nextPairs[leftItem.id];
                    setConfig({
                      ...config,
                      left: left.filter((row) => row.id !== leftItem.id),
                      right: right.filter((row) => row.id !== rightItem?.id),
                      pairs: nextPairs,
                    });
                  }}>
                    <X color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
                  </Pressable>
                </View>
              );
            })}
            <AddRow label="Juftlik qo‘shish" onPress={() => {
              if (left.length >= 6) return;
              const leftId = `l${newId()}`;
              const rightId = `r${newId()}`;
              setConfig({
                ...config,
                left: [...left, { id: leftId, text: "" }],
                right: [...right, { id: rightId, text: "" }],
                pairs: { ...pairs, [leftId]: rightId },
              });
            }} />
          </View>
        );
      }
      case "fill_blank": {
        const answers = config.answers ?? [];
        return (
          <View style={styles.block}>
            <Text style={styles.blockHint}>Qabul qilinadigan javoblar. Katta-kichik harf farqi yo‘q.</Text>
            <View style={styles.answerWrap}>
              {answers.map((answer, answerIndex) => (
                <Pressable key={`${answer}-${answerIndex}`} style={styles.answerChip}
                  onPress={() => setConfig({ ...config, answers: answers.filter((_, i) => i !== answerIndex) })}>
                  <Text style={styles.answerChipText}>{answer}</Text>
                  <X color={colors.primaryDeep} size={icon.xs} strokeWidth={icon.stroke} />
                </Pressable>
              ))}
            </View>
            <AnswerInput onAdd={(value) => {
              if (answers.length < 10 && value.trim()) setConfig({ ...config, answers: [...answers, value.trim()] });
            }} />
          </View>
        );
      }
      case "poll":
        return (
          <View style={styles.block}>
            <Text style={styles.blockHint}>Ovoz berish — to‘g‘ri javob yo‘q, ball berilmaydi.</Text>
            {options.map((option) => (
              <View key={option.id} style={styles.optionRow}>
                <TextInput style={styles.optionInput} value={option.text} maxLength={200}
                  onChangeText={(text) => setOptionText(option.id, text)} placeholder="Variant"
                  placeholderTextColor={colors.inkSoft} />
                <Pressable onPress={() => removeOption(option.id)} hitSlop={8}>
                  <X color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
                </Pressable>
              </View>
            ))}
            <AddRow label="Variant qo‘shish" onPress={addOption} />
          </View>
        );
      case "word_cloud":
        return <Text style={styles.blockHint}>Ishtirokchilar bitta so‘z yoki ibora yozadi; eng ko‘p uchraganlari ekranda kattaroq ko‘rinadi. Ball berilmaydi.</Text>;
      case "open_answer":
        return (
          <View style={styles.block}>
            <Text style={styles.blockHint}>Javoblarni natija bosqichida o‘zingiz baholaysiz.</Text>
            <TextInput style={[styles.input, styles.multiline]} value={config.reference ?? ""} maxLength={500}
              onChangeText={(text) => setConfig({ ...config, reference: text })}
              placeholder="Namuna javob (o‘zingiz uchun)" placeholderTextColor={colors.inkSoft} multiline />
          </View>
        );
      case "hotspot": {
        const region = config.region;
        const url = publicUrl(mediaPath);
        return (
          <View style={styles.block}>
            <Text style={styles.blockHint}>Rasmga bosib to‘g‘ri zonani belgilang.</Text>
            {url ? (
              <Pressable
                onLayout={(event: LayoutChangeEvent) => setImageBox({
                  width: event.nativeEvent.layout.width,
                  height: event.nativeEvent.layout.height,
                })}
                onPress={(event) => {
                  const size = region?.w ?? 0.2;
                  const x = Math.min(Math.max(event.nativeEvent.locationX / imageBox.width - size / 2, 0), 1 - size);
                  const y = Math.min(Math.max(event.nativeEvent.locationY / imageBox.height - size / 2, 0), 1 - size);
                  setConfig({ ...config, shape: "circle", region: { x, y, w: size, h: size } });
                }}
              >
                <Image source={{ uri: url }} style={styles.hotspotImage} resizeMode="cover" />
                {region ? (
                  <View pointerEvents="none" style={[styles.hotspotRegion, {
                    left: region.x * imageBox.width,
                    top: region.y * imageBox.height,
                    width: region.w * imageBox.width,
                    height: region.h * imageBox.height,
                    borderRadius: (region.w * imageBox.width) / 2,
                  }]} />
                ) : null}
              </Pressable>
            ) : null}
            {region ? (
              <View style={styles.sizeRow}>
                <Text style={styles.blockHint}>Zona kattaligi</Text>
                <Pressable style={styles.sizeButton} onPress={() => {
                  const size = Math.max((region.w ?? 0.2) - 0.05, 0.08);
                  setConfig({ ...config, region: { ...region, w: size, h: size } });
                }}><Minus color={colors.ink} size={icon.md} strokeWidth={icon.stroke} /></Pressable>
                <Pressable style={styles.sizeButton} onPress={() => {
                  const size = Math.min((region.w ?? 0.2) + 0.05, 0.6);
                  setConfig({ ...config, region: { ...region, w: size, h: size } });
                }}><Plus color={colors.ink} size={icon.md} strokeWidth={icon.stroke} /></Pressable>
              </View>
            ) : null}
          </View>
        );
      }
    }
  }

  return (
    <View style={styles.card}>
      <Pressable style={styles.cardHeader} onPress={() => setOpen((value) => !value)}>
        <View style={styles.indexBadge}><Text style={styles.indexText}>{index + 1}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.typeLabel}>{GAME_TYPE_LABELS[type]}</Text>
          <Text style={styles.promptPreview} numberOfLines={open ? undefined : 1}>
            {question.prompt || "Savol matni yozilmagan"}
          </Text>
        </View>
        {open
          ? <ChevronUp color={colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} />
          : <ChevronDown color={colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} />}
      </Pressable>

      {open ? (
        <View style={styles.body}>
          <TextInput style={[styles.input, styles.multiline]} value={prompt} onChangeText={setPrompt}
            placeholder="Savol matni" placeholderTextColor={colors.inkSoft} multiline maxLength={600} />

          {needsImage ? (
            <Pressable style={styles.imageButton} onPress={() => void pickImage()} disabled={uploading}>
              {uploading ? <ActivityIndicator color={colors.primary} /> : (
                <>
                  <ImagePlus color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
                  <Text style={styles.imageButtonText}>{mediaPath ? "Rasmni almashtirish" : "Rasm yuklash"}</Text>
                </>
              )}
            </Pressable>
          ) : null}
          {needsImage && type === "image_quiz" && mediaPath ? (
            <Image source={{ uri: publicUrl(mediaPath) ?? undefined }} style={styles.previewImage} resizeMode="cover" />
          ) : null}

          {renderAnswers()}

          <View style={styles.chipRow}>
            {GAME_TIME_LIMIT_PRESETS.map((preset) => (
              <Pressable key={preset} style={[styles.chip, time === preset && styles.chipActive]} onPress={() => setTime(preset)}>
                <Text style={[styles.chipText, time === preset && styles.chipTextActive]}>{preset}s</Text>
              </Pressable>
            ))}
          </View>
          {!noScore ? (
            <View style={styles.chipRow}>
              {GAME_POINT_PRESETS.filter((preset) => preset > 0).map((preset) => (
                <Pressable key={preset} style={[styles.chip, points === preset && styles.chipActive]} onPress={() => setPoints(preset)}>
                  <Text style={[styles.chipText, points === preset && styles.chipTextActive]}>{preset} ball</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <TextInput style={[styles.input, styles.multiline]} value={explanation} onChangeText={setExplanation}
            placeholder="Izoh — to‘g‘ri javob nima uchun to‘g‘ri" placeholderTextColor={colors.inkSoft} multiline maxLength={1000} />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actionsRow}>
            <Pressable style={styles.saveButton} onPress={() => void save()} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.onPrimary} size="small" /> : (
                <>
                  <Check color={colors.onPrimary} size={icon.md} strokeWidth={icon.strokeBold} />
                  <Text style={styles.saveText}>Saqlash</Text>
                </>
              )}
            </Pressable>
            {onRegenerate ? (
              <IconAction icon={RefreshCw} label="Qayta yaratish" spinning={regenerating} onPress={onRegenerate} />
            ) : null}
            <IconAction icon={Copy} label="Nusxalash" onPress={onDuplicate} />
            <IconAction icon={ArrowUp} label="Yuqoriga" disabled={index === 0} onPress={() => onMove(-1)} />
            <IconAction icon={ArrowDown} label="Pastga" disabled={index === total - 1} onPress={() => onMove(1)} />
            <IconAction icon={Trash2} label="O‘chirish" danger onPress={onDelete} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable style={styles.addRow} onPress={onPress}>
      <Plus color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
      <Text style={styles.addRowText}>{label}</Text>
    </Pressable>
  );
}

function AnswerInput({ onAdd }: { onAdd: (value: string) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [value, setValue] = useState("");
  return (
    <View style={styles.optionRow}>
      <TextInput style={styles.optionInput} value={value} onChangeText={setValue} maxLength={120}
        placeholder="Javob varianti" placeholderTextColor={colors.inkSoft}
        onSubmitEditing={() => { onAdd(value); setValue(""); }} returnKeyType="done" />
      <Pressable hitSlop={8} onPress={() => { onAdd(value); setValue(""); }}>
        <Plus color={colors.primary} size={icon.lg} strokeWidth={icon.stroke} />
      </Pressable>
    </View>
  );
}

function IconAction({ icon: Icon, label, onPress, disabled, danger, spinning }: {
  icon: typeof Copy; label: string; onPress: () => void; disabled?: boolean; danger?: boolean; spinning?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable style={styles.iconAction} onPress={onPress} disabled={disabled || spinning} accessibilityLabel={label}>
      {spinning ? <ActivityIndicator size="small" color={colors.primary} /> : (
        <Icon color={disabled ? colors.border : danger ? colors.danger : colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} />
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, overflow: "hidden",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  indexBadge: {
    width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.primarySoft,
    alignItems: "center", justifyContent: "center",
  },
  indexText: { ...typography.bodyMedium, color: colors.primaryDeep },
  typeLabel: { ...typography.caption, color: colors.accent },
  promptPreview: { ...typography.body, color: colors.ink },
  body: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  input: {
    ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  multiline: { minHeight: 60, textAlignVertical: "top" },
  block: { gap: spacing.sm },
  blockHint: { ...typography.caption, color: colors.inkMuted },
  optionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  optionInput: {
    flex: 1, ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  addRowText: { ...typography.body, color: colors.primary },
  tfButton: {
    flex: 1, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center",
    backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: "transparent",
  },
  tfButtonActive: { backgroundColor: colors.successSoft, borderColor: colors.success },
  tfText: { ...typography.bodyMedium, color: colors.inkMuted },
  tfTextActive: { color: colors.success },
  orderBadge: { ...typography.bodyMedium, color: colors.primaryDeep, width: 22, textAlign: "center" },
  pairArrow: { ...typography.body, color: colors.inkSoft },
  answerWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  answerChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  answerChipText: { ...typography.body, color: colors.primaryDeep },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: "transparent",
  },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.inkMuted },
  chipTextActive: { color: colors.primaryDeep },
  imageButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft,
  },
  imageButtonText: { ...typography.body, color: colors.primaryDeep },
  previewImage: { width: "100%", height: 160, borderRadius: radius.md },
  hotspotImage: { width: "100%", height: 220, borderRadius: radius.md },
  hotspotRegion: {
    position: "absolute", borderWidth: 3, borderColor: colors.success,
    backgroundColor: "rgba(15, 157, 116, 0.25)",
  },
  sizeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sizeButton: {
    width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted,
    alignItems: "center", justifyContent: "center",
  },
  error: { ...typography.caption, color: colors.danger },
  actionsRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  saveButton: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md,
  },
  saveText: { ...typography.bodyMedium, color: colors.onPrimary },
  iconAction: {
    width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted,
    alignItems: "center", justifyContent: "center",
  },
}));
