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
    /**
     * Short enough that three attempts fit inside a stage's budget.
     *
     * The default is generous because research legitimately takes a while; one
     * slide does not. At seventy-five seconds a slide that retried twice could
     * outlast the whole stage on its own, which is how a deck ends up killed
     * rather than failed.
     */
    timeoutMs: Number(Deno.env.get("GEMINI_TIMEOUT_MS") ?? "") || 45_000,
  });
}
