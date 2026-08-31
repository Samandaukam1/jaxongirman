import { supabase } from "@/lib/supabase";

/**
 * Which engine will build the deck this screen is about to ask for.
 *
 * Read the same way the server reads it, and that is the whole point: the
 * generation pipeline treats a missing or unreadable setting as the generative
 * engine, so if this guessed the other way the phone would offer a design
 * catalogue for a deck that will never use one. A chooser that does not choose
 * anything is worse than no chooser — the author picks, and the result ignores
 * them.
 *
 * Only a `false` actually read back turns it off. See `design-engine.ts` in the
 * edge functions, which has to agree with this.
 */
export async function generativeDesign(): Promise<boolean> {
  const { data, error } = await supabase
    .from("app_settings").select("value").eq("key", "design.generative_enabled").maybeSingle();
  if (error) return true;
  return data?.value !== false;
}
