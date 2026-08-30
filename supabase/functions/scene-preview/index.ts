/**
 * One deck, made by the generative engine, returned rather than saved.
 *
 * The engine is unit-tested against fakes, which proves the arithmetic and
 * proves nothing about whether a real model can answer this schema, whether
 * the font library has what the pairing asks for, or whether the image service
 * understands the intents. This is where that is found out — without touching
 * a customer's deck, without charging anybody, and without changing what
 * `generate-presentation` does today.
 *
 * Admin-only, and it stores nothing. What comes back is the scene graph, the
 * compiled rows a renderer would draw, and every number §38 asks to be kept.
 */

import { createClient } from "npm:@supabase/supabase-js";

import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { generateDeck, GenerativeFailure, type Deps } from "../_shared/scene-pipeline.ts";
import { sceneSchema } from "../_shared/scene-writer.ts";
import { slideSchema as planSlideSchema } from "../_shared/plan-schema.ts";
import type { LibraryFamily } from "../_shared/scene-dna.ts";

type Body = {
  probe?: boolean;
  persist?: boolean;
  topic?: string;
  titles?: string[];
  threshold?: number;
  maxAttempts?: number;
};

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const context = await requestContext(request);
    const { data: isAdmin } = await context.serviceClient.rpc("is_admin", { p_user_id: context.user.id });
    if (!isAdmin) throw new HttpError(403, "Forbidden", "forbidden");

    const body = await bodyJson<Body>(request, 32_000);

    /**
     * Which shape of schema the provider will actually accept.
     *
     * `INVALID_ARGUMENT` names nothing, so the alternative to this is guessing
     * one edit at a time through a deploy each. Each variant is asked a
     * trivial question; what matters is only whether the request is admitted.
     */
    if (body.probe === true) {
      const writer = geminiWriter();
      const full = sceneSchema();
      const strip = (node: unknown, drop: string[]): unknown => {
        if (Array.isArray(node)) return node.map((one) => strip(one, drop));
        if (!node || typeof node !== "object") return node;
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (drop.includes(key)) continue;
          out[key] = strip(value, drop);
        }
        return out;
      };
      const variants: Array<[string, Record<string, unknown>]> = [
        ["known_good_slide", planSlideSchema()],
        ["scene_full", full],
        ["scene_no_additional", strip(full, ["additionalProperties"]) as Record<string, unknown>],
        ["scene_no_limits", strip(full, ["minItems", "maxItems"]) as Record<string, unknown>],
        ["scene_no_enum", strip(full, ["enum"]) as Record<string, unknown>],
      ];
      const results: Record<string, string> = {};
      for (const [name, schema] of variants) {
        try {
          await writer.structured<unknown>({
            prompt: "Bitta namuna qaytaring.",
            schemaName: name,
            schema,
            maxOutputTokens: 200,
            attempts: 1,
          });
          results[name] = `ok (${JSON.stringify(schema).length} bayt)`;
        } catch (failure) {
          results[name] = `${failure instanceof Error ? failure.message.slice(0, 60) : "?"} (${JSON.stringify(schema).length} bayt)`;
        }
      }
      return json({ probe: results });
    }
    const topic = (body.topic ?? "").trim();
    if (!topic) throw new HttpError(400, "Mavzu yozilmadi.", "missing_topic");
    if (topic.length > 200) throw new HttpError(400, "Mavzu juda uzun.", "topic_too_long");

    const titles = (Array.isArray(body.titles) ? body.titles : [])
      .filter((one): one is string => typeof one === "string" && one.trim().length > 0)
      .slice(0, 6)
      .map((one) => one.trim());
    if (titles.length === 0) throw new HttpError(400, "Slayd sarlavhalari yuborilmadi.", "missing_titles");

    const writer = geminiWriter();
    const started = Date.now();

    const deps: Deps = {
      ask: async ({ prompt, schema, schemaName, maxOutputTokens }) => {
        try {
        const answer = await writer.structured<unknown>({
          prompt,
          system: "Siz professional taqdimot dizaynerisiz. Faqat so‘ralgan sxemada javob bering.",
          schemaName,
          schema,
          maxOutputTokens: maxOutputTokens ?? 2_000,
          attempts: 1,
        });
        return answer.data;
        } catch (failure) {
          // Which question was refused. A provider that answers
          // "INVALID_ARGUMENT" and names nothing is otherwise three schemas to
          // guess between.
          throw new Error(`${schemaName}: ${failure instanceof Error ? failure.message : String(failure)}`);
        }
      },

      /**
       * The library, exactly as the operator left it.
       *
       * Only active families, and only what the pairing needs to decide: a
       * name and a category. A face nobody enabled is a face no deck may be
       * set in.
       */
      fonts: async (): Promise<LibraryFamily[]> => {
        const { data, error } = await context.serviceClient
          .from("font_families")
          .select("canonical_name,category,is_featured")
          .eq("is_active", true)
          .order("is_featured", { ascending: false })
          .limit(400);
        if (error) throw new GenerativeFailure(error.message, "font_library_unreadable");
        return (data ?? []).map((row) => ({
          name: row.canonical_name as string,
          category: (row.category as string | null) ?? null,
        }));
      },

      /**
       * The existing image service, unchanged.
       *
       * This engine says what a picture should be of; everything about which
       * picture that is — the person safety rule, the verified library, the
       * provider ladder, the attribution — belongs to the service that already
       * decides it.
       */
      findImage: async (intent) => {
        const url = Deno.env.get("SUPABASE_URL");
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!url || !key) return null;
        const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const answer = await service.functions.invoke("image-resolution-service", {
          headers: { Authorization: `Bearer ${key}` },
          body: {
            action: "resolve",
            ownerId: context.user.id,
            presentationId: crypto.randomUUID(),
            query: intent.query,
            orientation: intent.orientation,
          },
        });
        const found = answer.data as { status?: string; bucket?: string; path?: string } | null;
        return found?.status === "selected" && found.path
          ? { bucket: found.bucket ?? "stock-images", path: found.path }
          : null;
      },

      beat: (note) => console.log(JSON.stringify({ event: "scene_progress", note })),
    };

    const deck = await generateDeck(deps, {
      topic,
      slides: titles.map((title) => ({ title })),
      threshold: typeof body.threshold === "number" ? Math.min(100, Math.max(50, body.threshold)) : 90,
      maxAttempts: typeof body.maxAttempts === "number" ? Math.min(4, Math.max(1, body.maxAttempts)) : 3,
    });

    console.log(JSON.stringify({
      event: "scene_preview_done",
      engine: deck.engine,
      seconds: Math.round((Date.now() - started) / 1000),
      scores: deck.observability.scores,
      repairs: deck.observability.repairCount,
      asks: deck.observability.askCount,
    }));

    /**
     * Saved, when asked — as a deck the app can open like any other.
     *
     * The point of persisting is that everything downstream is then testable
     * for real: the phone renders these rows, the exporter reads them, the
     * editor opens them. A preview that only ever returns JSON proves the
     * engine and nothing about the product.
     *
     * Owned by the administrator who asked, marked with the engine that made
     * it, and costing nothing: no job, no reservation, no credits. This is a
     * diagnostic, not a customer's deck.
     */
    let presentationId: string | null = null;
    if (body.persist === true) {
      presentationId = crypto.randomUUID();
      const created = await context.serviceClient.from("presentations").insert({
        id: presentationId,
        owner_id: context.user.id,
        title: topic.slice(0, 120),
        topic,
        style: "super_professional",
        status: "ready",
        requested_slide_count: deck.slides.length,
        generated_slide_count: deck.slides.length,
        design_engine: deck.engine,
        design_dna: { direction: deck.dna.direction, fonts: deck.dna.fonts, colors: deck.dna.colors, radius: deck.dna.radius },
      });
      if (created.error) throw new Error(`presentation not saved: ${created.error.message}`);

      const slideRows = [];
      const elementRows = [];
      for (const slide of deck.slides) {
        if (!slide.rendered) continue;
        const slideId = crypto.randomUUID();
        slideRows.push({
          id: slideId,
          presentation_id: presentationId,
          owner_id: context.user.id,
          position: slide.index,
          title: slide.title,
          layout: "title_content",
          background: slide.rendered.background,
          quality_score: slide.score,
          quality_report: {
            engine: deck.engine,
            accepted: slide.accepted,
            synthesised: slide.synthesised,
        mirrored: slide.mirrored,
            attempts: slide.attempts,
            faults: slide.faults,
            signature: slide.scene ? slide.scene.purpose : null,
          },
        });
        for (const row of slide.rendered.elements) {
          elementRows.push({
            id: crypto.randomUUID(),
            slide_id: slideId,
            presentation_id: presentationId,
            owner_id: context.user.id,
            type: row.type,
            x: row.x,
            y: row.y,
            width: row.width,
            height: row.height,
            rotation: row.rotation,
            // The scene's layer, kept as it is for now; ranked to integers
            // below, because a scrim sits at 3.5 and the column is an integer.
            z_index: row.z_index,
            opacity: row.opacity,
            locked: row.locked,
            style: row.style,
            content: row.content,
          });
        }
      }
      /**
       * Fractional layers become ranks.
       *
       * A scrim sits between an image and the title over it — 3.5 in the
       * scene's terms — and the column only holds integers. Ranking preserves
       * the order without the scene having to know that.
       */
      const ranked = [...elementRows].sort((a, b) => a.z_index - b.z_index);
      ranked.forEach((row, at) => { row.z_index = at; });

      const savedSlides = await context.serviceClient.from("slides").insert(slideRows);
      if (savedSlides.error) throw new Error(`slides not saved: ${savedSlides.error.message}`);
      const savedElements = await context.serviceClient.from("slide_elements").insert(elementRows);
      if (savedElements.error) throw new Error(`elements not saved: ${savedElements.error.message}`);
    }

    return json({
      presentationId,
      engine: deck.engine,
      seconds: Math.round((Date.now() - started) / 1000),
      dna: { direction: deck.dna.direction, fonts: deck.dna.fonts, colors: deck.dna.colors, radius: deck.dna.radius },
      slides: deck.slides.map((slide) => ({
        index: slide.index,
        title: slide.title,
        score: slide.score,
        accepted: slide.accepted,
        // Whether the model designed this page or the engine built it from the
        // brief. Left out of the first response, which made a check that
        // counted designed pages pass by looking at a field that was not there.
        synthesised: slide.synthesised,
        mirrored: slide.mirrored,
        attempts: slide.attempts,
        faults: slide.faults,
        scene: slide.scene,
        rendered: slide.rendered,
      })),
      observability: deck.observability,
    });
  } catch (error) {
    if (error instanceof GenerativeFailure) {
      return json({ error: error.message, code: error.code }, 422);
    }
    if (error instanceof HttpError) return errorResponse(error);
    /**
     * The technical message, deliberately.
     *
     * This endpoint exists to find out why the engine cannot run against the
     * real services, and it is reachable only by an administrator. "Server
     * operation failed" is the right answer for a customer and the useless one
     * here.
     */
    console.error(JSON.stringify({ event: "scene_preview_failed", message: error instanceof Error ? error.message : String(error) }));
    return json({
      error: error instanceof Error ? error.message : "Noma'lum xato",
      code: "generation_failed",
    }, 500);
  }
});
