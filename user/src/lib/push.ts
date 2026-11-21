import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter, type Href } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { i18n } from "../i18n";

import { supabase } from "./supabase";

/**
 * Push notifications on this phone.
 *
 * The server queues a push for everything in the in-app list and for every
 * chat message (supabase/migrations/202611150019_push_notifications.sql) and
 * sends it through Expo's push service to the tokens phones have registered.
 * This file is the phone's half: ask once for permission, register this
 * phone's Expo push token for the account signed in on it, drop it on sign
 * out, open the right screen when a push is tapped — and stay quiet about a
 * chat the person is already looking at.
 *
 * A phone without push (the browser, a simulator, an Android build made before
 * Firebase was configured) simply never registers; nothing else changes.
 */

const ENABLED_KEY = "push.enabled";
const TOKEN_KEY = "push.token";

export type PushState = "on" | "off" | "denied" | "unsupported";

/** The conversation on screen now, whose pushes are not shown while it is. */
let openConversation: string | null = null;
export function setOpenConversation(id: string | null) { openConversation = id; }
/** Leaving a conversation: quiet no longer — unless another conversation took its place meanwhile. */
export function clearOpenConversation(id: string) { if (openConversation === id) openConversation = null; }

const supported = () => Platform.OS === "ios" || Platform.OS === "android";

if (supported()) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = (notification.request.content.data ?? {}) as { conversation_id?: string };
      const quiet = Boolean(data.conversation_id && data.conversation_id === openConversation);
      return { shouldShowBanner: !quiet, shouldShowList: !quiet, shouldPlaySound: !quiet, shouldSetBadge: false };
    },
  });
}

async function channels() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: i18n.t("inbox:push.channelDefault"),
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: "#6C34C9",
  });
  await Notifications.setNotificationChannelAsync("chat", {
    name: i18n.t("inbox:push.channelChat"),
    importance: Notifications.AndroidImportance.MAX,
    lightColor: "#6C34C9",
  });
}

/** Whether the person has turned push off in the app (on unless they did). */
export async function pushWanted(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(ENABLED_KEY)) !== "0"; } catch { return true; }
}

/**
 * Registers this phone for the signed-in account. Asks for permission only
 * when `ask` is set — on first sign-in, or when the person turns push on —
 * never on every launch.
 */
export async function registerPush(ask: boolean): Promise<PushState> {
  if (!supported() || !Device.isDevice) return "unsupported";
  if (!(await pushWanted())) return "off";
  try {
    await channels();
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && ask && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return "denied";
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
      ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const { error } = await supabase.rpc("push_token_register" as never, {
      p_token: token, p_platform: Platform.OS, p_device: Device.deviceName ?? Device.modelName ?? "",
    } as never);
    if (error) throw error;
    await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => undefined);
    return "on";
  } catch {
    // No Firebase in this Android build, no network: push is simply not on yet.
    return "unsupported";
  }
}

/** Stops pushes to this phone for the account signed in on it. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return;
    await supabase.rpc("push_token_unregister" as never, { p_token: token } as never);
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // Signing out never waits on this; a stale token is moved or dropped by the server later.
  }
}

/** The person's own switch, in the notifications screen. */
export async function setPushWanted(on: boolean): Promise<PushState> {
  await AsyncStorage.setItem(ENABLED_KEY, on ? "1" : "0").catch(() => undefined);
  if (!on) { await unregisterPush(); return "off"; }
  return registerPush(true);
}

/** The state the switch shows, without asking anybody anything. */
export async function pushState(): Promise<PushState> {
  if (!supported() || !Device.isDevice) return "unsupported";
  if (!(await pushWanted())) return "off";
  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (!permission?.granted) return permission?.canAskAgain === false ? "denied" : "off";
  return (await AsyncStorage.getItem(TOKEN_KEY).catch(() => null)) ? "on" : "off";
}

/**
 * For the signed-in area: register this phone once per session, and open the
 * screen a tapped push points at — including the push that launched the app.
 */
export function usePush(userId: string | null) {
  const router = useRouter();

  useEffect(() => {
    if (!userId) return;
    void registerPush(true);
  }, [userId]);

  useEffect(() => {
    if (!userId || !supported()) return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const url = (response?.notification.request.content.data as { url?: unknown } | undefined)?.url;
      // Only the app's own paths: a push never opens the web.
      if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) router.push(url as Href);
    };
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) { open(response); void Notifications.clearLastNotificationResponseAsync?.(); }
    }).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [router, userId]);
}
