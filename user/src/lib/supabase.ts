import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Database } from "@jaxongirman/types";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

import { env } from "./env";

export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

let channelSerial = 0;

/**
 * A channel for database changes, private to the subscription asking for it.
 *
 * realtime-js keeps one channel per topic: asking for a topic that is already
 * joined hands back the joined channel, and `.on("postgres_changes")` on that
 * throws — "cannot add callbacks after subscribe()". Two mounted screens using
 * the same hook (Bosh sahifa and Profil both follow the marathon) were enough
 * to crash the app the moment the second one opened.
 *
 * Database changes are delivered by filter, not by topic name, so every
 * subscription can safely have a topic of its own. Broadcast channels are the
 * exception — devices meet on the topic — and must keep using `channel()`.
 */
export function changesChannel(name: string) {
  channelSerial += 1;
  return supabase.channel(`${name}:${Date.now().toString(36)}${channelSerial.toString(36)}`);
}

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
