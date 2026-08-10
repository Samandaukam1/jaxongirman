import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";

type Body = { presentationId?: string; format?: "pdf" | "png" | "pptx" };
type Element = { type: string; x: number; y: number; width: number; height: number; rotation: number; opacity: number; style: Record<string, unknown>; content: Record<string, unknown> };

function color(value: unknown, fallback = "#151A18") {
  const hex = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const output: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) line = candidate;
      else { output.push(line); line = word; }
    }
    if (line) output.push(line);
  }
  return output;
}

async function embedFont(pdf: PDFDocument): Promise<PDFFont> {
  try {
    pdf.registerFontkit(fontkit);
    const url = Deno.env.get("PDF_FONT_URL") ?? "https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/Manrope%5Bwght%5D.ttf";
    const response = await fetch(url);
    if (!response.ok) throw new Error("font download failed");
    return await pdf.embedFont(await response.arrayBuffer(), { subset: true });
  } catch {
    return await pdf.embedFont(StandardFonts.Helvetica);
  }
}

function winAnsiSafe(value: string, customFont: boolean) {
  return customFont ? value : value.normalize("NFKD").replace(/[^\x20-\xFF\n]/g, "'");
}

async function drawElement(page: PDFPage, pdf: PDFDocument, font: PDFFont, customFont: boolean, element: Element, service: ReturnType<typeof requestContext> extends Promise<infer T> ? T["serviceClient"] : never) {
  const y = 562.5 - element.y - element.height;
  if (element.type === "shape") {
    page.drawRectangle({ x: element.x, y, width: element.width, height: element.height, color: color(element.style.fill, "#DCE8DF"), opacity: element.opacity });
  } else if (element.type === "line") {
    page.drawLine({ start: { x: element.x, y: y + element.height / 2 }, end: { x: element.x + element.width, y: y + element.height / 2 }, thickness: Number(element.style.strokeWidth ?? 2), color: color(element.style.color), opacity: element.opacity });
  } else if (element.type === "text") {
    const size = Math.max(8, Number(element.style.fontSize ?? 24));
    const lineHeight = Number(element.style.lineHeight ?? size * 1.22);
    const text = winAnsiSafe(String(element.content.text ?? ""), customFont);
    const lines = wrap(text, font, size, element.width).slice(0, Math.max(1, Math.floor(element.height / lineHeight)));
    lines.forEach((line, index) => page.drawText(line, { x: element.x, y: 562.5 - element.y - size - index * lineHeight, size, font, color: color(element.style.color), opacity: element.opacity }));
  } else if (element.type === "image") {
    const bucket = String(element.content.storageBucket ?? "");
    const path = String(element.content.storagePath ?? "");
    if (!bucket || !path) return;
    const { data } = await service.storage.from(bucket).download(path);
    if (!data) return;
    const bytes = await data.arrayBuffer();
    const embedded = /\.png$/i.test(path) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    page.drawImage(embedded, { x: element.x, y, width: element.width, height: element.height, opacity: element.opacity });
  } else if (element.type === "chart") {
    const values = Array.isArray(element.content.values) ? element.content.values.map(Number).filter(Number.isFinite) : [];
    const max = Math.max(...values, 1);
    const gap = 8;
    const barWidth = values.length ? (element.width - gap * (values.length - 1)) / values.length : 0;
    values.forEach((value, index) => {
      const height = element.height * value / max;
      page.drawRectangle({ x: element.x + index * (barWidth + gap), y, width: barWidth, height, color: color(element.style.color, "#173E35") });
    });
  }
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let exportJobId: string | null = null;
  let serviceClient: Awaited<ReturnType<typeof requestContext>>["serviceClient"] | null = null;
  try {
    const context = await requestContext(request);
    serviceClient = context.serviceClient;
    const body = await bodyJson<Body>(request, 16_000);
    if (!body.presentationId || !body.format) throw new HttpError(400, "presentationId and format are required", "invalid_request");
    if (body.format !== "pdf") throw new HttpError(400, "Server export currently supports PDF; mobile PNG export captures the editable canvas", "unsupported_format");

    const { data: requested, error: requestError } = await context.userClient.rpc("request_export", { p_presentation_id: body.presentationId, p_format: "pdf", p_options: { source: "mobile" } });
    if (requestError || !requested) throw new HttpError(400, requestError?.message ?? "Export could not be queued", "export_request_failed");
    exportJobId = requested as string;
    await context.serviceClient.from("export_jobs").update({ status: "running", progress: 5, started_at: new Date().toISOString() }).eq("id", exportJobId);

    const [presentationResult, slidesResult, elementsResult] = await Promise.all([
      context.serviceClient.from("presentations").select("id,title,owner_id").eq("id", body.presentationId).eq("owner_id", context.user.id).single(),
      context.serviceClient.from("slides").select("*").eq("presentation_id", body.presentationId).order("position"),
      context.serviceClient.from("slide_elements").select("*").eq("presentation_id", body.presentationId).order("z_index"),
    ]);
    if (presentationResult.error) throw presentationResult.error;
    if (slidesResult.error) throw slidesResult.error;
    if (elementsResult.error) throw elementsResult.error;

    const pdf = await PDFDocument.create();
    const font = await embedFont(pdf);
    const customFont = font.name !== StandardFonts.Helvetica;
    for (const slide of slidesResult.data) {
      const page = pdf.addPage([1000, 562.5]);
      const background = slide.background && typeof slide.background === "object" && !Array.isArray(slide.background) ? slide.background as Record<string, unknown> : {};
      page.drawRectangle({ x: 0, y: 0, width: 1000, height: 562.5, color: color(background.color, "#F7F3EA") });
      for (const element of elementsResult.data.filter((row) => row.slide_id === slide.id) as Element[]) await drawElement(page, pdf, font, customFont, element, context.serviceClient);
    }
    const bytes = await pdf.save();
    const path = `${context.user.id}/${body.presentationId}/${exportJobId}.pdf`;
    const { error: uploadError } = await context.serviceClient.storage.from("exports").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw uploadError;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await context.serviceClient.from("export_jobs").update({ status: "succeeded", progress: 100, storage_path: path, completed_at: new Date().toISOString(), expires_at: expiresAt }).eq("id", exportJobId);
    const { data: signed, error: signedError } = await context.serviceClient.storage.from("exports").createSignedUrl(path, 3600);
    if (signedError) throw signedError;
    return json({ jobId: exportJobId, signedUrl: signed.signedUrl, expiresAt, message: "PDF tayyor. Havola 1 soat amal qiladi." });
  } catch (error) {
    if (exportJobId && serviceClient) await serviceClient.from("export_jobs").update({ status: "failed", error_message: error instanceof Error ? error.message.slice(0, 1000) : "Export failed", completed_at: new Date().toISOString() }).eq("id", exportJobId);
    return errorResponse(error);
  }
});
