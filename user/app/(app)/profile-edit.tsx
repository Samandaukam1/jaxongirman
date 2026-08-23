import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Camera, User as UserIcon } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { avatarContentType, avatarObjectPath, cacheBusted } from "@/lib/avatar";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { colors, radius, shadow, spacing, typography } from "@/theme/tokens";

/**
 * Editing a profile, which is not the same screen as having one.
 *
 * The profile tab used to be this form. Every visit — to check a coin balance,
 * to open the tariff, to sign out — opened a page of text inputs with a Save
 * button under them, which is a screen for a task nobody was doing. So the two
 * are separated: the tab shows who you are, and this is where you change it.
 *
 * Everything here writes to `profiles`, which is granted column by column and
 * governed by `profiles_update_own`; nothing on this screen can reach another
 * person's row.
 */

type Draft = {
  firstName: string;
  lastName: string;
  username: string;
  bio: string;
  organization: string;
  fieldOfStudy: string;
};

const EMPTY: Draft = {
  firstName: "", lastName: "", username: "", bio: "", organization: "", fieldOfStudy: "",
};

const USERNAME_RULE = /^[a-z0-9_]{3,24}$/;

export default function ProfileEditScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState<Draft>(EMPTY);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error: readError } = await supabase
      .from("profiles")
      .select("first_name,last_name,username,bio,avatar_url,organization,field_of_study")
      .eq("id", user.id)
      .single();
    if (readError) setError(asErrorMessage(readError));
    else {
      const next: Draft = {
        firstName: data.first_name ?? "",
        lastName: data.last_name ?? "",
        username: data.username ?? "",
        bio: data.bio ?? "",
        organization: data.organization ?? "",
        fieldOfStudy: data.field_of_study ?? "",
      };
      setDraft(next);
      setSaved(next);
      setAvatarUrl(data.avatar_url);
      setError(null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const usernameValid = draft.username === "" || USERNAME_RULE.test(draft.username);

  async function save() {
    if (!user) return;
    if (!usernameValid) {
      setError("Username 3–24 ta kichik harf, raqam yoki pastki chiziqdan iborat bo‘lsin.");
      return;
    }
    setSaving(true); setError(null);
    const { error: saveError } = await supabase.from("profiles").update({
      first_name: draft.firstName.trim(),
      last_name: draft.lastName.trim(),
      username: draft.username.trim() || null,
      bio: draft.bio.trim(),
      organization: draft.organization.trim() || null,
      field_of_study: draft.fieldOfStudy.trim() || null,
    }).eq("id", user.id);

    if (saveError) {
      // The unique index is the only thing that can truthfully answer "is this
      // handle free?", so its rejection is what the person is told about.
      setError(saveError.code === "23505" ? "Bu username band. Boshqasini tanlang." : asErrorMessage(saveError));
      setSaving(false);
      return;
    }
    setSaved(draft);
    setSaving(false);
    router.back();
  }

  async function changeAvatar() {
    if (!user) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    setUploading(true); setError(null);
    try {
      /**
       * Bytes, not a Blob.
       *
       * `fetch(uri).blob()` on React Native returns a Blob with no usable type,
       * and supabase-js sends a Blob as multipart where the part's type comes
       * from the Blob rather than from the `contentType` beside it. The bucket
       * was offered `text/plain` and refused it. An ArrayBuffer has no opinion
       * about its own type, which makes the option the only answer.
       */
      const response = await fetch(asset.uri);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error("Rasm o‘qilmadi. Boshqa rasm tanlang.");
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Rasm 5 MB dan katta. Kichikroq rasm tanlang.");

      const contentType = avatarContentType(asset);
      const path = avatarObjectPath(user.id, Crypto.randomUUID(), contentType);
      const { error: uploadError } = await supabase.storage.from("avatars")
        .upload(path, bytes, { contentType, upsert: true });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updateError } = await supabase.from("profiles")
        .update({ avatar_url: data.publicUrl }).eq("id", user.id);
      if (updateError) throw updateError;
      setAvatarUrl(cacheBusted(data.publicUrl));
    } catch (uploadError) {
      setError(asErrorMessage(uploadError));
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScreenHeader title="Profilni tahrirlash" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.avatarBlock}>
          <Pressable
            accessibilityLabel="Profil rasmini o‘zgartirish"
            disabled={uploading}
            onPress={() => void changeAvatar()}
            style={styles.avatarWrap}
          >
            {avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarEmpty]}><UserIcon color={colors.primary} size={40} strokeWidth={1.7} /></View>}
            <View style={styles.avatarBadge}>
              {uploading
                ? <ActivityIndicator color={colors.onPrimary} size="small" />
                : <Camera color={colors.onPrimary} size={16} strokeWidth={2} />}
            </View>
          </Pressable>
          <Text style={styles.avatarHint}>Rasmni almashtirish uchun bosing</Text>
        </View>

        {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={styles.card}>
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

          <Text style={styles.label}>O‘quv yurti yoki tashkilot</Text>
          <TextInput value={draft.organization} onChangeText={(value) => setDraft({ ...draft, organization: value })} placeholder="O‘zbekiston jurnalistika universiteti" placeholderTextColor={colors.inkSoft} style={styles.input} maxLength={160} />
          <Text style={styles.hint}>Obyektivka va ilmiy ishlarda shu nom ishlatiladi.</Text>

          <Text style={styles.label}>Yo‘nalish</Text>
          <TextInput value={draft.fieldOfStudy} onChangeText={(value) => setDraft({ ...draft, fieldOfStudy: value })} placeholder="Jurnalistika" placeholderTextColor={colors.inkSoft} style={styles.input} maxLength={160} />

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
        </View>

        <Pressable
          disabled={!dirty || saving || !usernameValid}
          onPress={() => void save()}
          style={[styles.saveButton, (!dirty || saving || !usernameValid) && styles.disabled]}
        >
          {saving
            ? <ActivityIndicator color={colors.onPrimary} size="small" />
            : <Text style={styles.saveText}>Saqlash</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  content: { padding: spacing.xl, paddingBottom: spacing.xl * 2, gap: spacing.lg },
  avatarBlock: { alignItems: "center", gap: spacing.sm },
  avatarWrap: { width: 108, height: 108, marginBottom: spacing.xs },
  avatar: { width: 108, height: 108, borderRadius: 34 },
  avatarEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  avatarBadge: { position: "absolute", right: -4, bottom: -4, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.canvas },
  avatarHint: { ...typography.caption, color: colors.inkMuted },
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.xs, ...shadow },
  pair: { flexDirection: "row", gap: spacing.md },
  pairItem: { flex: 1 },
  label: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.sm, marginBottom: 6 },
  input: { ...typography.body, color: colors.ink, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  inputInvalid: { borderColor: colors.danger },
  bioInput: { minHeight: 104, paddingTop: spacing.md, textAlignVertical: "top" },
  usernameRow: { flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  usernamePrefix: { ...typography.body, color: colors.inkMuted },
  usernameInput: { ...typography.body, flex: 1, color: colors.ink, paddingVertical: 0 },
  hint: { ...typography.caption, color: colors.inkSoft },
  errorBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  errorText: { ...typography.caption, color: colors.danger },
  saveButton: { minHeight: 54, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  saveText: { ...typography.body, fontWeight: "700", color: colors.onPrimary },
  disabled: { opacity: 0.5 },
});
