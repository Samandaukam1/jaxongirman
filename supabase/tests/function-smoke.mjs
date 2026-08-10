import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

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
const { url, anonKey, serviceKey } = localEnvironment();
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `function-smoke-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Test user was not created");

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

  const exported = await user.functions.invoke("export-presentation", { body: { presentationId, format: "pdf" } });
  if (exported.error) throw exported.error;
  assert(typeof exported.data?.signedUrl === "string", "PDF export did not return a signed URL");

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
    pdfExport: "signed-url-created",
    wallet: walletResult.data,
  }, null, 2));
} finally {
  await service.auth.admin.deleteUser(created.data.user.id);
}
