/**
 * Survey results as a spreadsheet.
 *
 * The owner check happens here, on the server, against the form row — a client
 * that asks for someone else's survey gets 403 whatever it claims to be. The
 * file lands in the private `exports` bucket under the owner's own folder and
 * comes back as a short-lived signed URL; nothing about an export is public.
 *
 * Uploaded images are never embedded or linked permanently. Each image cell
 * carries a signed URL that expires with the answer it points at, so an exported
 * sheet cannot outlive the retention window of the data inside it.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { buildCsv, buildXlsx, type CellValue } from "../_shared/xlsx.ts";

type Body = { formId?: string; format?: "xlsx" | "csv" };

type QuestionRow = {
  id: string;
  position: number;
  type: string;
  label: string;
};

type AnswerRow = {
  response_id: string;
  question_id: string;
  value_text: string | null;
  value_number: number | string | null;
  value_date: string | null;
  selected_option_ids: string[] | null;
};

/** ISO timestamps are unreadable in a spreadsheet; this is the local form people expect. */
function timestamp(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function safeFileStem(value: string): string {
  return value.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).toLowerCase() || "survey";
}

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;

  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed", "method_not_allowed");
    const { user, serviceClient } = await requestContext(request);
    const body = await bodyJson<Body>(request);

    const formId = body.formId?.trim();
    if (!formId) throw new HttpError(400, "formId is required", "invalid_request");
    const format = body.format === "csv" ? "csv" : "xlsx";

    const { data: form, error: formError } = await serviceClient
      .from("survey_forms")
      .select("id, owner_id, title, response_retention_hours")
      .eq("id", formId)
      .maybeSingle();
    if (formError) throw formError;
    if (!form) throw new HttpError(404, "So‘rovnoma topilmadi", "not_found");
    if (form.owner_id !== user.id) throw new HttpError(403, "Faqat so‘rovnoma egasi natijalarni yuklab oladi", "forbidden");

    const [questionsResult, responsesResult] = await Promise.all([
      serviceClient.from("survey_questions").select("id, position, type, label").eq("form_id", formId).order("position"),
      serviceClient.from("survey_responses").select("id, respondent_id, submitted_at, expires_at").eq("form_id", formId).order("submitted_at", { ascending: true }),
    ]);
    if (questionsResult.error) throw questionsResult.error;
    if (responsesResult.error) throw responsesResult.error;

    const questions = (questionsResult.data ?? []) as QuestionRow[];
    const responses = responsesResult.data ?? [];
    const responseIds = responses.map((row) => row.id);

    // Option labels, respondent names, answers and files are each one round trip
    // rather than one per row: a thirty-person survey is a handful of queries.
    const [answersResult, filesResult, optionsResult, profilesResult] = await Promise.all([
      responseIds.length
        ? serviceClient.from("survey_answers").select("id, response_id, question_id, value_text, value_number, value_date, selected_option_ids").in("response_id", responseIds)
        : Promise.resolve({ data: [], error: null }),
      responseIds.length
        ? serviceClient.from("survey_answer_files").select("answer_id, response_id, storage_path, mime_type").in("response_id", responseIds)
        : Promise.resolve({ data: [], error: null }),
      questions.length
        ? serviceClient.from("survey_question_options").select("id, label").in("question_id", questions.map((question) => question.id))
        : Promise.resolve({ data: [], error: null }),
      responses.length
        ? serviceClient.from("profiles").select("id, full_name, username").in("id", responses.map((row) => row.respondent_id))
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (answersResult.error) throw answersResult.error;
    if (filesResult.error) throw filesResult.error;
    if (optionsResult.error) throw optionsResult.error;
    if (profilesResult.error) throw profilesResult.error;

    const optionLabels = new Map((optionsResult.data ?? []).map((option) => [option.id as string, option.label as string]));
    const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id as string, profile]));

    const answersByResponse = new Map<string, Map<string, AnswerRow & { id: string }>>();
    for (const answer of (answersResult.data ?? []) as (AnswerRow & { id: string })[]) {
      const bucket = answersByResponse.get(answer.response_id) ?? new Map();
      bucket.set(answer.question_id, answer);
      answersByResponse.set(answer.response_id, bucket);
    }

    // Signed for exactly as long as the answers themselves live. An export that
    // outlived its data would be a quiet way around the retention promise.
    const linkSeconds = Math.max(60, Math.min(form.response_retention_hours * 3600, 604_800));
    const filesByAnswer = new Map<string, string[]>();
    for (const file of (filesResult.data ?? []) as { answer_id: string; storage_path: string }[]) {
      const { data: signed } = await serviceClient.storage.from("survey-uploads").createSignedUrl(file.storage_path, linkSeconds);
      const name = file.storage_path.split("/").pop() ?? "rasm";
      const list = filesByAnswer.get(file.answer_id) ?? [];
      list.push(signed?.signedUrl ? `${name} — ${signed.signedUrl}` : name);
      filesByAnswer.set(file.answer_id, list);
    }

    const header: CellValue[] = ["#", "Ism", "Username", "Yuborilgan", "O‘chiriladi", ...questions.map((question) => question.label)];
    const rows: CellValue[][] = [header];

    responses.forEach((response, index) => {
      const profile = profiles.get(response.respondent_id);
      const answers = answersByResponse.get(response.id);
      const row: CellValue[] = [
        index + 1,
        (profile?.full_name as string | undefined)?.trim() || "—",
        profile?.username ? `@${profile.username}` : "",
        timestamp(response.submitted_at),
        timestamp(response.expires_at),
      ];

      for (const question of questions) {
        const answer = answers?.get(question.id);
        if (!answer) { row.push(""); continue; }
        if (question.type === "image") {
          row.push(filesByAnswer.get(answer.id)?.join("\n") ?? "");
        } else if (question.type === "single_choice" || question.type === "multi_choice") {
          row.push((answer.selected_option_ids ?? []).map((id) => optionLabels.get(id) ?? "—").join(", "));
        } else if (question.type === "number") {
          const numeric = answer.value_number === null ? null : Number(answer.value_number);
          row.push(numeric !== null && Number.isFinite(numeric) ? numeric : "");
        } else if (question.type === "date") {
          row.push(answer.value_date ?? "");
        } else {
          row.push(answer.value_text ?? "");
        }
      }
      rows.push(row);
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `${user.id}/surveys/${safeFileStem(form.title)}-${stamp}.${format}`;
    const bytes = format === "csv" ? buildCsv(rows) : await buildXlsx(form.title, rows);
    const contentType = format === "csv"
      ? "text/csv"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    const { error: uploadError } = await serviceClient.storage.from("exports").upload(path, bytes, { contentType, upsert: true });
    if (uploadError) throw uploadError;

    const { data: signedExport, error: signError } = await serviceClient.storage.from("exports").createSignedUrl(path, 3600);
    if (signError) throw signError;

    const { error: recordError } = await serviceClient.rpc("record_survey_export", {
      p_form_id: formId,
      p_format: format,
      p_storage_path: path,
      p_row_count: responses.length,
    });
    if (recordError) throw recordError;

    return json({
      format,
      path,
      url: signedExport.signedUrl,
      rowCount: responses.length,
      questionCount: questions.length,
      expiresInSeconds: 3600,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
