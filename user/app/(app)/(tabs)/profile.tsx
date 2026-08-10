import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Camera, Check, ChevronRight, Coins, CreditCard, LogOut, Store, User as UserIcon, Wallet } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

type Draft = { firstName: string; lastName: string; username: string; bio: string };

const EMPTY: Draft = { firstName: "", lastName: "", username: "", bio: "" };
const USERNAME_RULE = /^[a-z0-9_]{3,24}$/;

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState<Draft>(EMPTY);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const [profileResult, walletResult] = await Promise.all([
      supabase.from("profiles").select("first_name,last_name,username,bio,avatar_url").eq("id", user.id).single(),
      supabase.from("credit_wallets").select("balance").eq("user_id", user.id).single(),
    ]);
    if (profileResult.error) setError(asErrorMessage(profileResult.error));
    else {
      const next: Draft = {
        firstName: profileResult.data.first_name ?? "",
        lastName: profileResult.data.last_name ?? "",
        username: profileResult.data.username ?? "",
        bio: profileResult.data.bio ?? "",
      };
      setDraft(next);
      setSaved(next);
      setAvatarUrl(profileResult.data.avatar_url);
      setError(null);
    }
    if (!walletResult.error) setCredits(walletResult.data.balance);
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const usernameValid = draft.username === "" || USERNAME_RULE.test(draft.username);

  async function save() {
    if (!user) return;
    if (!usernameValid) { setError("Username 3–24 ta kichik harf, raqam yoki pastki chiziqdan iborat bo‘lsin."); return; }
    setSaving(true); setError(null);
    const { error: saveError } = await supabase.from("profiles").update({
      first_name: draft.firstName.trim(),
      last_name: draft.lastName.trim(),
      username: draft.username.trim() || null,
      bio: draft.bio.trim(),
    }).eq("id", user.id);
    if (saveError) {
      // The unique index is the only thing that can truthfully answer "is this
      // handle free?", so its rejection is what the user is told about.
      setError(saveError.code === "23505" ? "Bu username band. Boshqasini tanlang." : asErrorMessage(saveError));
    } else {
      setSaved(draft);
      setFlash("Profil saqlandi");
      setTimeout(() => setFlash(null), 2200);
    }
    setSaving(false);
  }

  async function changeAvatar() {
    if (!user) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    setUploading(true); setError(null);
    try {
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const path = `${user.id}/${Crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, blob, { contentType: asset.mimeType ?? "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updateError } = await supabase.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", user.id);
      if (updateError) throw updateError;
      setAvatarUrl(data.publicUrl);
      setFlash("Rasm yangilandi");
      setTimeout(() => setFlash(null), 2200);
    } catch (uploadError) {
      setError(asErrorMessage(uploadError));
    } finally {
      setUploading(false);
    }
  }

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

        <View style={styles.avatarBlock}>
          <Pressable accessibilityLabel="Profil rasmini o‘zgartirish" disabled={uploading} onPress={() => void changeAvatar()} style={styles.avatarWrap}>
            {avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarEmpty]}><UserIcon color={colors.primary} size={40} strokeWidth={1.7} /></View>}
            <View style={styles.avatarBadge}>
              {uploading ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Camera color={colors.onPrimary} size={16} strokeWidth={2} />}
            </View>
          </Pressable>
          <Text style={styles.avatarName}>{[draft.firstName, draft.lastName].filter(Boolean).join(" ") || "Ismingizni kiriting"}</Text>
          <Text style={styles.avatarEmail}>{user?.email}</Text>
        </View>

        <View style={styles.creditCard}>
          <View style={styles.creditIcon}><Coins color={colors.primary} size={22} strokeWidth={1.9} /></View>
          <View style={styles.creditCopy}>
            <Text style={styles.creditLabel}>Qolgan tangalar</Text>
            <Text style={styles.creditValue}>{credits}</Text>
          </View>
        </View>

        {flash ? <View style={styles.flash}><Check color={colors.success} size={16} strokeWidth={2.4} /><Text style={styles.flashText}>{flash}</Text></View> : null}
        {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={styles.formCard}>
          <View style={styles.pair}>
            <View style={styles.pairItem}>
              <Text style={styles.label}>Ism</Text>
              <TextInput value={draft.firstName} onChangeText={(value) => setDraft({ ...draft, firstName: value })} placeholder="Jahongir" placeholderTextColor={colors.inkSoft} style={styles.input} maxLength={60} />
            </View>
            <View style={styles.pairItem}>
              <Text style={styles.label}>Familiya</Text>
              <TextInput value={draft.lastName} onChangeText={(value) => setDraft({ ...draft, lastName: value })} placeholder="Qurbonnazarov" placeholderTextColor={colors.inkSoft} style={styles.input} maxLength={60} />
            </View>
          </View>

          <Text style={styles.label}>Username</Text>
          <View style={[styles.usernameRow, !usernameValid && styles.inputInvalid]}>
            <Text style={styles.usernamePrefix}>@</Text>
            <TextInput
              value={draft.username}
              onChangeText={(value) => setDraft({ ...draft, username: value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24) })}
              placeholder="jaxongir"
              placeholderTextColor={colors.inkSoft}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.usernameInput}
            />
          </View>
          <Text style={styles.hint}>3–24 ta kichik harf, raqam yoki pastki chiziq.</Text>

          <Text style={styles.label}>Bio</Text>
          <TextInput
            value={draft.bio}
            onChangeText={(value) => setDraft({ ...draft, bio: value })}
            placeholder="O‘zingiz haqingizda qisqacha…"
            placeholderTextColor={colors.inkSoft}
            multiline
            maxLength={280}
            style={[styles.input, styles.bioInput]}
          />
          <Text style={styles.hint}>{draft.bio.length} / 280</Text>

          <Pressable disabled={!dirty || saving || !usernameValid} onPress={() => void save()} style={[styles.saveButton, (!dirty || saving || !usernameValid) && styles.disabled]}>
            {saving ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Text style={styles.saveText}>Saqlash</Text>}
          </Pressable>
        </View>

        {/* Sozlamalar: the marketplace surfaces a person owns. */}
        <View style={styles.settingsBlock}>
          {[
            { label: "Mahsulotlarim", detail: "Do‘konga qo‘yganlaringiz", icon: Store, href: "/(app)/marketplace/seller" as const },
            { label: "Daromadlar", detail: "Sotuvlar va to‘lovlar", icon: Wallet, href: "/(app)/earnings" as const },
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
  avatarBlock: { alignItems: "center", gap: 4 },
  avatarWrap: { width: 108, height: 108, marginBottom: spacing.sm },
  avatar: { width: 108, height: 108, borderRadius: 34 },
  avatarEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  avatarBadge: { position: "absolute", right: -4, bottom: -4, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.canvas },
  avatarName: { ...typography.heading, color: colors.ink },
  avatarEmail: { ...typography.caption, color: colors.inkMuted },
  creditCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  creditIcon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  creditCopy: { flex: 1 },
  creditLabel: { ...typography.caption, color: colors.primaryDeep },
  creditValue: { fontFamily: "Manrope_700Bold", fontSize: 26, color: colors.primaryDeep, letterSpacing: -0.5 },
  formCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, ...shadow },
  pair: { flexDirection: "row", gap: spacing.md },
  pairItem: { flex: 1 },
  label: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.sm, marginBottom: 6 },
  input: { ...typography.body, color: colors.ink, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  inputInvalid: { borderColor: colors.danger },
  bioInput: { minHeight: 96, paddingTop: spacing.md, textAlignVertical: "top" },
  usernameRow: { flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  usernamePrefix: { ...typography.body, color: colors.inkSoft },
  usernameInput: { ...typography.body, color: colors.ink, flex: 1, paddingVertical: spacing.sm },
  hint: { ...typography.caption, color: colors.inkSoft },
  saveButton: { height: 52, marginTop: spacing.lg, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  saveText: { ...typography.bodyMedium, color: colors.onPrimary },
  disabled: { opacity: 0.4 },
  flash: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successSoft },
  flashText: { ...typography.caption, color: colors.success },
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
