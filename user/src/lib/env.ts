const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase client environment is incomplete. Copy user/.env.example to user/.env.");
}

export const env = {
  supabaseUrl: supabaseUrl ?? "http://127.0.0.1:54321",
  supabaseAnonKey: supabaseAnonKey ?? "missing-anon-key",
};
