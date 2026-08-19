/**
 * Getting a design the typefaces it asked for.
 *
 * A design imported from a template names its fonts and ships none of them, so
 * it draws in a fallback — which for a design whose typography is most of what
 * was bought is not a small difference. Most of those names are open families
 * anybody can fetch, and making an administrator hunt for `Inter` by hand is
 * asking them to run a machine's errand once per design, since nothing would
 * remember the tenth time.
 *
 * So the families are a shelf. A face is downloaded once, stored under the
 * family rather than under the design, and every later design that names it
 * takes a copy. The copy is real rather than a reference because the design's
 * own folder is where the upload rule puts files and where the bucket policy
 * expects to find them; sharing saves the download and the licence check, which
 * is what was actually expensive.
 *
 * Nothing here trusts a name from a file. The host is fixed, the family is
 * escaped into a query parameter, the response has to look like a font, and
 * there is a ceiling on the bytes.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { contentHash } from "../_shared/jslayd/serialize.ts";
import { readDocument } from "../_shared/jslayd/serialize.ts";
import {
  MAX_FONT_BYTES, WANTED_WEIGHTS, faceFileName, isFontFile, looksLikeFont,
  normaliseFamily, readStylesheet, stylesheetRequest,
} from "../_shared/font-source.ts";

const BUCKET = "design-fonts";
/** Where a family's own copy lives, apart from any design that borrows it. */
const LIBRARY = "library";

type Body = { designId?: string };

type ResolvedFace = { asset: string; format: string; weight: number; italic: boolean };

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const context = await requestContext(request);
    const { data: isAdmin } = await context.serviceClient.rpc("is_admin", { p_user_id: context.user.id });
    if (!isAdmin) throw new HttpError(403, "forbidden", "forbidden");

    const body = await bodyJson<Body>(request);
    const designId = (body.designId ?? "").trim();
    if (!designId) throw new HttpError(400, "designId yuborilmadi.", "missing_design");

    const service = context.serviceClient;
    const design = await service
      .from("presentation_designs")
      .select("id, slug, compiled_config")
      .eq("id", designId)
      .maybeSingle();
    if (design.error || !design.data) throw new HttpError(404, "Dizayn topilmadi.", "design_missing");

    const read = readDocument(design.data.compiled_config);
    if (!read.document) throw new HttpError(422, "Dizayn hujjati o‘qilmadi.", "document_unreadable");
    const document = read.document;
    const slug = design.data.slug as string;

    const report: { font: string; name: string; faces: number; source: string; note?: string }[] = [];
    const updatedFonts = [];

    for (const font of document.fonts) {
      const normalized = normaliseFamily(font.name);
      if (!normalized) { updatedFonts.push(font); continue; }

      // The shelf. Created on first sight so the eleventh design that names
      // this family finds it rather than discovering it again.
      const family = await service.from("font_families")
        .upsert({ canonical_name: font.name, normalized_name: normalized, source: "google" },
          { onConflict: "normalized_name" })
        .select("id, license_metadata")
        .single();
      if (family.error) {
        report.push({ font: font.id, name: font.name, faces: 0, source: "error", note: family.error.message });
        updatedFonts.push(font);
        continue;
      }

      let shelved = await service.from("font_faces")
        .select("weight, italic, format, storage_path")
        .eq("family_id", family.data.id);
      let source = "library";

      if ((shelved.data ?? []).length === 0) {
        source = "google";
        const fetched = await fetchFamily(font.name);
        if (fetched.length === 0) {
          report.push({ font: font.id, name: font.name, faces: 0, source: "unavailable" });
          updatedFonts.push(font);
          continue;
        }

        for (const face of fetched) {
          const path = `${LIBRARY}/${normalized}/${face.weight}${face.italic ? "i" : ""}.${face.format}`;
          const stored = await service.storage.from(BUCKET)
            .upload(path, face.bytes, { upsert: true, contentType: `font/${face.format}` });
          if (stored.error) continue;
          await service.from("font_faces").upsert({
            family_id: family.data.id,
            weight: face.weight,
            italic: face.italic,
            format: face.format,
            storage_path: path,
            content_hash: await sha256(face.bytes),
            byte_size: face.bytes.byteLength,
          }, { onConflict: "family_id,weight,italic" });
        }
        await service.from("font_families").update({
          license_metadata: { provider: "google-fonts", terms: "https://fonts.google.com/attribution" },
        }).eq("id", family.data.id);

        shelved = await service.from("font_faces")
          .select("weight, italic, format, storage_path")
          .eq("family_id", family.data.id);
      }

      // The design's own copy, under the folder the upload rule and the bucket
      // policy both expect.
      const faces: ResolvedFace[] = [];
      for (const face of shelved.data ?? []) {
        const fileName = faceFileName(font.id, face.weight as number, Boolean(face.italic), face.format as string);
        const target = `${slug}/${fileName}`;
        const copied = await service.storage.from(BUCKET).copy(face.storage_path as string, target);
        // A copy that already exists is not a failure; it is the second run.
        if (copied.error && !/exist/i.test(copied.error.message)) continue;

        await service.from("presentation_design_fonts").upsert({
          design_id: designId,
          font_id: font.id,
          name: font.name,
          roles: font.roles,
          asset_path: target,
          format: face.format,
          weight: face.weight,
          italic: face.italic,
          fallback: font.fallback,
        }, { onConflict: "design_id,font_id,weight,italic" });

        // Stored as the full object key. The renderer accepts either spelling,
        // and the full one is what the file is actually addressed by.
        faces.push({ asset: target, format: face.format as string, weight: face.weight as number, italic: Boolean(face.italic) });
      }

      await service.from("design_font_usage").upsert({
        design_id: designId,
        family_id: family.data.id,
        requested_name: font.name,
        resolved: faces.length > 0,
      }, { onConflict: "design_id,family_id" });

      report.push({ font: font.id, name: font.name, faces: faces.length, source });
      updatedFonts.push(faces.length > 0 ? { ...font, faces } : font);
    }

    /**
     * The document itself, so an export embeds the design's own outlines.
     *
     * The on-screen renderer reads the table and would already be right; the
     * exporters read the document. Writing only one of the two is how a deck
     * comes out of the app in one typeface and out of the PDF in another.
     */
    const next = { ...document, fonts: updatedFonts };
    const saved = await service.from("presentation_designs")
      .update({ compiled_config: next, content_hash: await contentHash(next as never) })
      .eq("id", designId);
    if (saved.error) throw saved.error;

    return json({ ok: true, fonts: report });
  } catch (error) {
    return errorResponse(error);
  }
});

/** Every usable face of one family, downloaded. */
async function fetchFamily(name: string): Promise<{ weight: number; italic: boolean; format: string; bytes: Uint8Array }[]> {
  const request = stylesheetRequest({ family: name, weights: WANTED_WEIGHTS, italics: true });
  const stylesheet = await fetch(request.url, { headers: request.headers });
  // A family Google does not have answers 400. That is an answer, not a fault.
  if (!stylesheet.ok) return [];

  const discovered = readStylesheet(await stylesheet.text());
  const out: { weight: number; italic: boolean; format: string; bytes: Uint8Array }[] = [];

  for (const face of discovered.slice(0, 8)) {
    if (!isFontFile(face.url)) continue;
    const file = await fetch(face.url);
    if (!file.ok) continue;
    const declared = Number(file.headers.get("content-length") ?? 0);
    if (declared > MAX_FONT_BYTES) continue;

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Checked after the fact too: a missing or lying `content-length` is not a
    // reason to store four megabytes of something.
    if (bytes.byteLength > MAX_FONT_BYTES || !looksLikeFont(bytes)) continue;
    out.push({ weight: face.weight, italic: face.italic, format: face.format, bytes });
  }
  return out;
}
