import { GeminiWriter } from "./writer.ts";

/**
 * Where the writer gets its key.
 *
 * One line of substance, in its own file, because everything else about the
 * writer is now testable and `Deno.env` is the single thing that stops a module
 * from being. Keeping the environment here and the rules in `writer.ts` is what
 * lets the retry policy, the ungrounded fallback and the error sanitising all
 * be covered by `node --test` on a machine with no Deno on it.
 *
 * The key is read from `GEMINI_API_KEY` and never leaves the server. Nothing in
 * this path is reachable from an app bundle: Edge functions run on Supabase's
 * infrastructure and the mobile client calls them, not Google.
 *
 * The model names are defaults, not decisions. Both are overridden by their own
 * variables, which is what makes moving to a new generation — or moving back
 * off one that misbehaves — a setting rather than a deploy.
 */
export function geminiWriter(): GeminiWriter {
  return new GeminiWriter({
    apiKey: Deno.env.get("GEMINI_API_KEY") ?? "",
    researchModel: Deno.env.get("GEMINI_RESEARCH_MODEL") ?? "gemini-3.5-flash-lite",
    writingModel: Deno.env.get("GEMINI_WRITING_MODEL") ?? "gemini-3.5-flash-lite",
  });
}
