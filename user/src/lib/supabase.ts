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

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
