import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { createClient } from "@supabase/supabase-js";

function localEnvironment() {
  const output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  const values = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(?:"([^"]*)"|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3];
  }
  const url = values.API_URL;
  const anonKey = values.ANON_KEY ?? values.PUBLISHABLE_KEY;
  const serviceKey = values.SERVICE_ROLE_KEY ?? values.SECRET_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Local Supabase status did not return the required test credentials");
  return { url, anonKey, serviceKey };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function preserveArtifact(fileName, bytes) {
  const directory = process.env.EXPORT_SMOKE_ARTIFACT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, fileName), bytes);
}

function reachable(signedUrl, apiUrl) {
  const target = new URL(signedUrl);
  const api = new URL(apiUrl);
  target.protocol = api.protocol;
  target.hostname = api.hostname;
  target.port = api.port;
  return target.toString();
}

async function waitForExport(user, jobId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await user.from("export_jobs").select("*").eq("id", jobId).single();
    if (result.error) throw result.error;
    if (result.data.status === "succeeded") return result.data;
    if (result.data.status === "failed") throw new Error(result.data.error_message ?? "Export failed");
    await sleep(250);
  }
  throw new Error(`Export ${jobId} did not finish`);
}

function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65_557) && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("PPTX end-of-central-directory was not found");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Invalid PPTX central directory");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("Invalid PPTX local entry");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(start, start + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? new Uint8Array(inflateRawSync(compressed)) : null;
    if (content) entries.set(name, content);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const { url, anonKey, serviceKey } = localEnvironment();
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `function-smoke-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Test user was not created");
const storageCleanup = [];

try {
  const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const presentationId = randomUUID();
  const generated = await user.functions.invoke("generate-presentation", {
    body: {
      presentationId,
      topic: "Sun’iy intellekt va ta’lim kelajagi",
      title: "AI va ta’lim",
      style: "simple",
      slideCount: 5,
      sources: ["Jaxongirman local smoke test"],
      idempotencyKey: `smoke:${presentationId}`,
    },
  });
  if (generated.error) throw generated.error;

  let presentation;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await user.from("presentations").select("status,generated_slide_count,error_message").eq("id", presentationId).maybeSingle();
    if (result.error) throw result.error;
    presentation = result.data;
    if (presentation?.status === "ready" || presentation?.status === "failed") break;
    await sleep(500);
  }
  assert(presentation?.status === "ready", `Generation did not finish ready: ${presentation?.error_message ?? presentation?.status}`);

  const slidesResult = await user.from("slides").select("id").eq("presentation_id", presentationId).order("position");
  if (slidesResult.error) throw slidesResult.error;
  assert(slidesResult.data.length === 5, "Expected five generated slides");
  const firstSlideId = slidesResult.data[0].id;

  // A real stored image exercises private service-role asset loading and proves
  // PPTX keeps it as a separate picture rather than flattening the slide.
  const imagePath = `${created.data.user.id}/${presentationId}/${randomUUID()}.png`;
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwM0WQAAAABJRU5ErkJggg==", "base64");
  const imageUpload = await user.storage.from("user-uploads").upload(imagePath, pixel, { contentType: "image/png" });
  if (imageUpload.error) throw imageUpload.error;
  storageCleanup.push({ bucket: "user-uploads", path: imagePath });
  const imageElement = await user.from("slide_elements").insert({
    slide_id: firstSlideId,
    presentation_id: presentationId,
    owner_id: created.data.user.id,
    type: "image",
    x: 760,
    y: 390,
    width: 140,
    height: 100,
    rotation: 0,
    z_index: 90,
    opacity: 1,
    locked: false,
    style: { objectFit: "cover", borderRadius: 12 },
    content: { storageBucket: "user-uploads", storagePath: imagePath },
  });
  if (imageElement.error) throw imageElement.error;

  // The mock editor targets the largest text on the slide, which is what
  // "Sarlavhani kattalashtir" means. This used to pick by z_index, but the slide
  // templates give every element on a slide the same depth, so the order was
  // arbitrary and the assertion below measured a footnote the edit never touched.
  const textElementsResult = await user.from("slide_elements").select("id,style").eq("slide_id", firstSlideId).eq("type", "text");
  if (textElementsResult.error) throw textElementsResult.error;
  const beforeResult = {
    data: [...textElementsResult.data].sort((a, b) => Number(b.style?.fontSize ?? 0) - Number(a.style?.fontSize ?? 0))[0],
    error: null,
  };
  if (beforeResult.error) throw beforeResult.error;
  const fontBefore = Number(beforeResult.data.style?.fontSize ?? 0);
  const edited = await user.functions.invoke("edit-presentation", { body: { presentationId, slideId: firstSlideId, command: "Sarlavhani kattalashtir" } });
  if (edited.error) throw edited.error;
  const afterResult = await user.from("slide_elements").select("style").eq("id", beforeResult.data.id).single();
  if (afterResult.error) throw afterResult.error;
  const fontAfter = Number(afterResult.data.style?.fontSize ?? 0);
  assert(fontAfter > fontBefore, "Mock AI edit did not change the title font size");

  async function exportAndDownload(format) {
    const requested = await user.functions.invoke("export-presentation", { body: { presentationId, format } });
    if (requested.error) throw requested.error;
    assert(typeof requested.data?.jobId === "string", `${format} export did not queue a job`);
    const job = await waitForExport(user, requested.data.jobId);
    assert(job.format === format && job.progress === 100, `${format} job did not complete at 100%`);
    assert(typeof job.storage_path === "string" && job.storage_path.startsWith(`${created.data.user.id}/${presentationId}/`), `${format} storage path is not owner-bound`);
    assert(typeof job.file_name === "string" && job.file_name.endsWith(`.${format}`), `${format} filename is missing`);
    assert(Number(job.size_bytes) > 0, `${format} size metadata is missing`);
    storageCleanup.push({ bucket: "exports", path: job.storage_path });
    const signed = await user.storage.from("exports").createSignedUrl(job.storage_path, 300, { download: job.file_name });
    if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error(`${format} signed URL was not created`);
    const response = await fetch(reachable(signed.data.signedUrl, url));
    assert(response.ok, `${format} signed URL did not download`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(bytes.length === Number(job.size_bytes), `${format} size metadata does not match the object`);
    return { job, bytes, contentType: response.headers.get("content-type") ?? "" };
  }

  const pdfExport = await exportAndDownload("pdf");
  preserveArtifact(pdfExport.job.file_name, pdfExport.bytes);
  assert(new TextDecoder().decode(pdfExport.bytes.subarray(0, 5)) === "%PDF-", "PDF signature is invalid");
  assert(pdfExport.contentType.includes("application/pdf"), "PDF content type is invalid");
  const pdfText = new TextDecoder("latin1").decode(pdfExport.bytes);
  assert(/\/Type\s*\/Pages[\s\S]{0,160}\/Count\s+5\b/.test(pdfText), "PDF does not contain five pages");

  const pptxExport = await exportAndDownload("pptx");
  preserveArtifact(pptxExport.job.file_name, pptxExport.bytes);
  assert(pptxExport.bytes[0] === 0x50 && pptxExport.bytes[1] === 0x4b, "PPTX ZIP signature is invalid");
  assert(pptxExport.contentType.includes("presentationml.presentation"), "PPTX content type is invalid");
  const entries = zipEntries(pptxExport.bytes);
  const slideNames = [...entries.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert(slideNames.length === 5, "PPTX does not contain five slide parts");
  const slideXml = slideNames.map((name) => new TextDecoder().decode(entries.get(name))).join("\n");
  assert(slideXml.includes("<a:t>"), "PPTX has no editable text runs");
  assert(slideXml.includes("<p:sp>"), "PPTX has no editable shape objects");
  assert(slideXml.includes("<p:pic>"), "PPTX image is not a separate picture object");

  const pngExport = await user.functions.invoke("export-presentation", { body: { presentationId, format: "png" } });
  assert(Boolean(pngExport.error), "PNG remained a server export option");

  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const privateRead = await anon.storage.from("exports").download(pdfExport.job.storage_path);
  assert(Boolean(privateRead.error), "A signed-out caller downloaded a private export");

  // The element JSON is user-editable. A service-role renderer must never use
  // it to read another account's private object, even when the path is known.
  const foreignOwner = randomUUID();
  const foreignPath = `${foreignOwner}/${presentationId}/${randomUUID()}.png`;
  const foreignUpload = await service.storage.from("generated-images").upload(foreignPath, pixel, { contentType: "image/png" });
  if (foreignUpload.error) throw foreignUpload.error;
  storageCleanup.push({ bucket: "generated-images", path: foreignPath });
  const injected = await user.from("slide_elements").insert({
    slide_id: firstSlideId,
    presentation_id: presentationId,
    owner_id: created.data.user.id,
    type: "image",
    x: 20,
    y: 20,
    width: 40,
    height: 40,
    style: {},
    content: { storageBucket: "generated-images", storagePath: foreignPath },
  });
  if (injected.error) throw injected.error;
  const unsafeRequest = await user.functions.invoke("export-presentation", { body: { presentationId, format: "pdf" } });
  if (unsafeRequest.error) throw unsafeRequest.error;
  let unsafeJob;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await user.from("export_jobs").select("status,error_message").eq("id", unsafeRequest.data.jobId).single();
    if (result.error) throw result.error;
    unsafeJob = result.data;
    if (unsafeJob.status === "failed") break;
    await sleep(250);
  }
  assert(unsafeJob?.status === "failed", "Cross-owner asset path was not rejected");

  const [stepsResult, walletResult] = await Promise.all([
    user.from("generation_steps").select("id", { count: "exact", head: true }).eq("presentation_id", presentationId),
    user.from("credit_wallets").select("balance,reserved,lifetime_spent").single(),
  ]);
  if (stepsResult.error) throw stepsResult.error;
  if (walletResult.error) throw walletResult.error;
  assert(walletResult.data.reserved === 0, "Credits remained reserved after completion");

  console.log(JSON.stringify({
    generation: presentation.status,
    slides: slidesResult.data.length,
    progressSteps: stepsResult.count,
    aiEdit: { changed: edited.data?.changed, fontBefore, fontAfter },
    pdfExport: { bytes: pdfExport.bytes.length, pages: 5 },
    pptxExport: { bytes: pptxExport.bytes.length, slides: slideNames.length, editable: true },
    exportSecurity: "private-and-owner-bound",
    wallet: walletResult.data,
  }, null, 2));
} finally {
  for (const item of storageCleanup) await service.storage.from(item.bucket).remove([item.path]);
  await service.auth.admin.deleteUser(created.data.user.id);
}
