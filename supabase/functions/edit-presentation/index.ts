import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { geminiWriter } from "../_shared/gemini.ts";
import { editorOperationsSchema } from "../_shared/plan-schema.ts";

type Body = { presentationId?: string; slideId?: string; command?: string };
type ElementRow = { id: string; slide_id: string; type: string; x: number; y: number; width: number; height: number; rotation: number; z_index: number; opacity: number; style: Record<string, unknown>; content: Record<string, unknown> };
type AiOperation = { elementId: string; x: number | null; y: number | null; width: number | null; height: number | null; rotation: number | null; zIndex: number | null; opacity: number | null; text: string | null; fill: string | null; color: string | null; fontSize: number | null };
type AiResult = { operations: AiOperation[]; explanation: string };

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

function deterministicEdit(command: string, elements: ElementRow[]): AiResult {
  const text = elements.filter((element) => element.type === "text").sort((a, b) => Number(b.style.fontSize ?? 0) - Number(a.style.fontSize ?? 0))[0];
  if (!text) return { operations: [], explanation: "Tahrirlanadigan matn topilmadi" };
  const lower = command.toLocaleLowerCase("uz");
  if (lower.includes("kattalashtir")) return { operations: [{ elementId: text.id, x: null, y: null, width: null, height: null, rotation: null, zIndex: null, opacity: null, text: null, fill: null, color: null, fontSize: Number(text.style.fontSize ?? 32) + 8 }], explanation: "Asosiy matn kattalashtirildi" };
  if (lower.includes("qisqartir")) return { operations: [{ elementId: text.id, x: null, y: null, width: null, height: null, rotation: null, zIndex: null, opacity: null, text: String(text.content.text ?? "").split(/[.!?]/)[0]?.slice(0, 180) ?? "", fill: null, color: null, fontSize: null }], explanation: "Matn qisqartirildi" };
  return { operations: [], explanation: "Mock rejim bu buyruqni o‘zgartirmadi" };
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 32_000);
    if (!body.presentationId || !body.slideId || !body.command?.trim()) throw new HttpError(400, "presentationId, slideId and command are required", "invalid_request");
    const command = body.command.trim().slice(0, 600);

    const [presentationResult, slideResult, elementResult] = await Promise.all([
      context.userClient.from("presentations").select("id,title,visual_dna").eq("id", body.presentationId).single(),
      context.userClient.from("slides").select("id,title,layout,background").eq("id", body.slideId).eq("presentation_id", body.presentationId).single(),
      context.userClient.from("slide_elements").select("id,slide_id,type,x,y,width,height,rotation,z_index,opacity,style,content").eq("slide_id", body.slideId).order("z_index"),
    ]);
    if (presentationResult.error) throw new HttpError(404, "Presentation not found", "not_found");
    if (slideResult.error) throw new HttpError(404, "Slide not found", "not_found");
    if (elementResult.error) throw elementResult.error;
    const elements = elementResult.data as ElementRow[];

    const lower = command.toLocaleLowerCase("uz");
    if (/(hamma|barcha|butun)/.test(lower) && /(ko['‘’`]?k|blue)/.test(lower)) {
      const { data: allElements, error } = await context.userClient.from("slide_elements").select("id,slide_id,type,x,y,width,height,rotation,z_index,opacity,style,content").eq("presentation_id", body.presentationId).limit(300);
      if (error) throw error;
      let changed = 0;
      for (const item of allElements as ElementRow[]) {
        const oldStyle = item.style ?? {};
        const style = item.type === "shape" ? { ...oldStyle, fill: "#DCE8F5" } : item.type === "text" ? { ...oldStyle, color: "#153B5B" } : oldStyle;
        if (style === oldStyle) continue;
        const { error: rpcError } = await context.userClient.rpc("apply_editor_operation", {
          p_presentation_id: body.presentationId,
          p_slide_id: item.slide_id,
          p_operation: { action: "update", elementId: item.id, patch: { style } },
          p_inverse_operation: { action: "update", elementId: item.id, patch: { style: oldStyle } },
        });
        if (rpcError) throw rpcError;
        changed += 1;
      }
      return json({ changed, explanation: "Barcha slaydlarga professional ko‘k rang yo‘nalishi qo‘llandi" });
    }

    // The same provider that writes a deck edits one. Routing this elsewhere
    // would put the editor back on a second bill for no benefit.
    const writer = geminiWriter();
    const mode = Deno.env.get("GENERATION_MODE") ?? "real";
    let result: AiResult;
    let usage: { input_tokens?: number; output_tokens?: number } = {};
    let requestId: string | null = null;
    let model = writer.writingModel;
    if (mode === "mock") {
      result = deterministicEdit(command, elements);
    } else {
      if (!writer.configured) throw new HttpError(503, "AI xizmati sozlanmagan", "provider_not_configured");
      const system = "You translate a user's Uzbek or English presentation edit request into safe structured element patches. Use only existing element IDs. Keep all geometry inside a 1000 by 562.5 canvas. Preserve readability: body font >=16, titles >=28, opacity 0..1, width/height >10. Make the smallest set of changes that fulfills the request. Return only the schema.";
      const prompt = `Presentation: ${presentationResult.data.title}\nVisual DNA: ${JSON.stringify(presentationResult.data.visual_dna)}\nSlide: ${JSON.stringify(slideResult.data)}\nElements: ${JSON.stringify(elements)}\nCommand: ${command}`;
      const response = await writer.structured<AiResult>({
        prompt: `${system}\n\n${prompt}`,
        system,
        schemaName: "editor_operations",
        schema: editorOperationsSchema,
      });
      result = response.data;
      usage = response.usage;
      requestId = response.requestId;
      model = response.model;
    }

    const byId = new Map(elements.map((element) => [element.id, element]));
    let changed = 0;
    for (const operation of result.operations) {
      const old = byId.get(operation.elementId);
      if (!old) continue;
      const patch: Record<string, unknown> = {};
      const inverse: Record<string, unknown> = {};
      for (const [key, value] of Object.entries({
        x: operation.x === null ? null : clamp(operation.x, 0, 990),
        y: operation.y === null ? null : clamp(operation.y, 0, 552),
        width: operation.width === null ? null : clamp(operation.width, 10, 1000 - old.x),
        height: operation.height === null ? null : clamp(operation.height, 10, 562.5 - old.y),
        rotation: operation.rotation === null ? null : clamp(operation.rotation, -360, 360),
        zIndex: operation.zIndex,
        opacity: operation.opacity === null ? null : clamp(operation.opacity, 0.1, 1),
      })) {
        if (value === null) continue;
        patch[key] = value;
        inverse[key] = key === "zIndex" ? old.z_index : old[key as keyof ElementRow];
      }
      const style = { ...(old.style ?? {}) };
      const oldStyle = { ...(old.style ?? {}) };
      if (operation.fill !== null) style.fill = operation.fill;
      if (operation.color !== null) style.color = operation.color;
      if (operation.fontSize !== null) style.fontSize = clamp(operation.fontSize, old.type === "text" ? 16 : 1, 140);
      if (JSON.stringify(style) !== JSON.stringify(oldStyle)) { patch.style = style; inverse.style = oldStyle; }
      if (operation.text !== null && old.type === "text") { patch.content = { ...(old.content ?? {}), text: operation.text.slice(0, 1200) }; inverse.content = old.content; }
      if (!Object.keys(patch).length) continue;
      const { error } = await context.userClient.rpc("apply_editor_operation", {
        p_presentation_id: body.presentationId,
        p_slide_id: body.slideId,
        p_operation: { action: "update", elementId: old.id, patch },
        p_inverse_operation: { action: "update", elementId: old.id, patch: inverse },
      });
      if (error) throw error;
      changed += 1;
    }

    if (mode === "real") await context.serviceClient.from("ai_usage").insert({ owner_id: context.user.id, presentation_id: body.presentationId, provider: "google", model, operation: "editor_command", input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0, request_id: requestId, metadata: { slide_id: body.slideId, changed } });
    return json({ changed, explanation: result.explanation });
  } catch (error) {
    return errorResponse(error);
  }
});
