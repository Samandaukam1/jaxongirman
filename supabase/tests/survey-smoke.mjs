/**
 * End-to-end check of the data-collection module against a running local stack.
 *
 * Creates two disposable accounts, builds a survey, answers it as the second
 * person, exports the results through the Edge Function, and verifies the
 * retention sweep removes what it should. Both accounts and everything that
 * cascades from them are deleted at the end, whether or not the run succeeded.
 *
 * Requires: npx supabase start, and
 *           npx supabase functions serve --env-file supabase/functions/.env
 */
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
  const dbUrl = values.DB_URL;
  if (!url || !anonKey || !serviceKey || !dbUrl) throw new Error("Local Supabase status did not return the required test credentials");
  return { url, anonKey, serviceKey, dbUrl };
}

/**
 * Inside the local stack an Edge Function sees SUPABASE_URL as http://kong:8000,
 * so the signed URL it hands back names a host only the Docker network can
 * resolve. Hosted projects return their public URL and need no rewriting; this
 * keeps the local run honest without changing what the function returns.
 */
function reachable(signedUrl, apiUrl) {
  const target = new URL(signedUrl);
  const api = new URL(apiUrl);
  target.protocol = api.protocol;
  target.host = api.host;
  return target.toString();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

const { url, anonKey, serviceKey, dbUrl } = localEnvironment();

/**
 * Ages a row so the retention sweep has something to find.
 *
 * Deliberately out of band, through psql rather than the API: service_role holds
 * only SELECT on the survey tables, because every legitimate server-side write
 * in this module goes through a security-definer function. A test that could
 * reach in and rewrite expires_at over the API would be proving the wrong thing.
 */
function expireResponses(formId) {
  execFileSync("psql", [dbUrl, "-q", "-c",
    `update public.survey_responses set expires_at = now() - interval '1 minute' where form_id = '${formId}'`],
    { encoding: "utf8" });
}
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function makeAccount(label) {
  const email = `survey-smoke-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Sm0ke!${randomUUID().slice(0, 10)}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

const created = [];

try {
  console.log("Creating disposable accounts…");
  const owner = await makeAccount("owner");
  const respondent = await makeAccount("respondent");
  created.push(owner.id, respondent.id);
  await service.from("profiles").update({ first_name: "Jahongir", last_name: "Owner" }).eq("id", owner.id);
  await service.from("profiles").update({ first_name: "Dilnoza", last_name: "Respondent" }).eq("id", respondent.id);

  console.log("Authoring a survey…");
  const { data: formId, error: saveError } = await owner.client.rpc("save_survey_form", {
    p_form_id: null,
    p_title: "Smoke guruh ma'lumotlari",
    p_description: "Avtomatik tekshiruv uchun",
    p_deadline: new Date(Date.now() + 86_400_000).toISOString(),
    p_expected_participants: 1,
    p_privacy_note: "Faqat tekshiruv uchun",
    p_questions: [
      { type: "short_text", label: "F.I.Sh.", is_required: true, latin_only: true },
      { type: "phone", label: "Telefon", is_required: true },
      { type: "number", label: "Yosh", is_required: false, config: { min: 10, max: 90 } },
      { type: "single_choice", label: "Kurs", is_required: true, options: [{ label: "1-kurs" }, { label: "2-kurs" }] },
    ],
  });
  if (saveError) throw saveError;
  assert(typeof formId === "string", "survey was created through save_survey_form");

  const { error: openError } = await owner.client.rpc("set_survey_status", { p_form_id: formId, p_status: "open" });
  if (openError) throw openError;
  assert(true, "survey was opened");

  console.log("Answering as the respondent…");
  const { data: opened, error: openSurveyError } = await respondent.client.rpc("open_survey", { p_form_id: formId });
  if (openSurveyError) throw openSurveyError;
  assert(opened.questions.length === 4, "respondent sees every question through open_survey");

  const byType = Object.fromEntries(opened.questions.map((question) => [question.type, question]));

  const cyrillic = await respondent.client.rpc("submit_survey_response", {
    p_form_id: formId,
    p_answers: [
      { question_id: byType.short_text.id, text: "Жаҳонгир" },
      { question_id: byType.phone.id, text: "901234567" },
      { question_id: byType.single_choice.id, option_ids: [byType.single_choice.options[0].id] },
    ],
    p_idempotency_key: randomUUID(),
  });
  assert(Boolean(cyrillic.error), "a Cyrillic answer to a latin-only question is refused by the server");

  const { count: afterReject } = await service
    .from("survey_responses").select("id", { count: "exact", head: true }).eq("form_id", formId);
  assert(afterReject === 0, "the refused submission left no response row behind");

  const { data: submitted, error: submitError } = await respondent.client.rpc("submit_survey_response", {
    p_form_id: formId,
    p_answers: [
      { question_id: byType.short_text.id, text: "Dilnoza Qodirova" },
      { question_id: byType.phone.id, text: "90 123 45 67" },
      { question_id: byType.number.id, number: "21" },
      { question_id: byType.single_choice.id, option_ids: [byType.single_choice.options[1].id] },
    ],
    p_idempotency_key: randomUUID(),
  });
  if (submitError) throw submitError;
  assert(submitted.applied === true, "a valid submission is accepted");
  assert(Boolean(submitted.expires_at), "the response carries an expiry");

  console.log("Reading results as the owner…");
  const { data: summary, error: summaryError } = await owner.client.rpc("survey_results_summary", { p_form_id: formId });
  if (summaryError) throw summaryError;
  assert(summary.form.submitted_count === 1, "the owner sees the response count");

  const { data: strangerRead } = await owner.client.rpc("survey_response_rows", { p_form_id: formId, p_limit: 10 });
  assert(strangerRead.length === 1 && strangerRead[0].answers, "the owner can read the response table");

  console.log("Exporting through the Edge Function…");
  for (const format of ["xlsx", "csv"]) {
    const { data: exported, error: exportError } = await owner.client.functions.invoke("export-survey", { body: { formId, format } });
    if (exportError) {
      const detail = exportError.context instanceof Response ? await exportError.context.clone().text() : "";
      throw new Error(`${format} export failed: ${exportError.message} ${detail}`);
    }
    assert(exported.rowCount === 1, `${format} export reports one row`);
    const download = await fetch(reachable(exported.url, url));
    const bytes = new Uint8Array(await download.arrayBuffer());
    assert(download.ok && bytes.length > 0, `${format} export downloads from its signed URL`);
    if (format === "xlsx") {
      assert(bytes[0] === 0x50 && bytes[1] === 0x4b, "the xlsx export is a real ZIP container");
    } else {
      const text = new TextDecoder().decode(bytes);
      assert(text.includes("+998901234567"), "the csv export contains the normalized phone answer");
      assert(text.includes("2-kurs"), "the csv export resolves choice ids to labels");
    }
  }

  const { data: strangerExport } = await respondent.client.functions.invoke("export-survey", { body: { formId, format: "csv" } });
  assert(strangerExport === null || strangerExport?.url === undefined, "a respondent cannot export someone else's survey");

  console.log("Sweeping expired responses…");
  expireResponses(formId);
  const purge = await fetch(`${url}/functions/v1/purge-survey-responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const purgeResult = await purge.json();
  assert(purge.ok && purgeResult.purged >= 1, "the retention sweep removed the expired response");

  const { count: afterPurge } = await service
    .from("survey_responses").select("id", { count: "exact", head: true }).eq("form_id", formId);
  assert(afterPurge === 0, "no response survives its retention window");

  // Scoped to this run's response id: a global count would also be measuring
  // whatever else happens to be in a shared local database.
  const { count: answersLeft } = await service
    .from("survey_answers").select("id", { count: "exact", head: true }).eq("response_id", submitted.response_id);
  assert(answersLeft === 0, "the answers cascaded away with the response");

  const { data: audit } = await service.from("survey_purge_audit").select("responses_purged").eq("form_id", formId);
  assert((audit ?? []).length === 1, "the sweep recorded counts — and only counts — in the audit table");

  const unauthorized = await fetch(`${url}/functions/v1/purge-survey-responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: "{}",
  });
  assert(unauthorized.status === 401, "the sweep refuses a caller without the scheduler credential");

  console.log("\nData collection smoke test passed.");
} finally {
  for (const id of created) {
    await service.auth.admin.deleteUser(id).catch(() => undefined);
  }
  console.log("Disposable accounts removed.");
}
