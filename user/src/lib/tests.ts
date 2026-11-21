import type { Tables } from "@jaxongirman/types";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { forgetPicture } from "@/lib/omr/frame";
import { supabase } from "@/lib/supabase";

/**
 * Printed tests: made by AI or by hand, printed with an answer sheet, checked
 * by holding the camera over the filled sheet (read on the phone, `lib/omr`),
 * by a photo read on the server (`test-scan`) or by typing the answers in.
 * A result is graded by the database (`test_save_result`), never here.
 */

export type Test = Tables<"tests">;
export type TestQuestion = Tables<"test_questions">;
export type TestResult = Tables<"test_results">;

export const TEST_COUNT_PRESETS = [10, 15, 20, 25, 30] as const;
export const TEST_OPTION_PRESETS = [3, 4, 5] as const;
export const MAX_TEST_QUESTIONS = 60;
export const OPTION_LETTERS = ["A", "B", "C", "D", "E"] as const;

async function functionError(error: unknown): Promise<never> {
  const context = (error as { context?: unknown }).context;
  if (context && typeof (context as Response).json === "function") {
    const body = await (context as Response).json().catch(() => null) as { error?: string } | null;
    if (body?.error) throw new Error(body.error);
  }
  throw error;
}

export type GenerateTestInput = {
  mode: "topic" | "text" | "presentation";
  topic?: string;
  text?: string;
  presentationId?: string;
  language?: string;
  difficulty: string;
  audience: string;
  questionCount: number;
  optionCount: number;
  layout: "combined" | "separate";
};

export async function generateTest(input: GenerateTestInput): Promise<string> {
  const { data, error } = await supabase.functions.invoke("generate-test", { body: input });
  if (error) await functionError(error);
  return (data as { testId: string }).testId;
}

export async function createManualTest(input: {
  ownerId: string; title: string; language: string; optionCount: number; layout: "combined" | "separate";
}): Promise<string> {
  const { data, error } = await supabase.from("tests").insert({
    owner_id: input.ownerId, title: input.title, language: input.language, source_type: "manual",
    option_count: input.optionCount, print_layout: input.layout,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function listTests(ownerId: string): Promise<Test[]> {
  const { data, error } = await supabase.from("tests").select("*").eq("owner_id", ownerId)
    .order("updated_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function loadTest(id: string): Promise<{ test: Test; questions: TestQuestion[] }> {
  const [test, questions] = await Promise.all([
    supabase.from("tests").select("*").eq("id", id).single(),
    supabase.from("test_questions").select("*").eq("test_id", id).order("position").order("created_at").order("id"),
  ]);
  if (test.error) throw test.error;
  if (questions.error) throw questions.error;
  return { test: test.data, questions: questions.data ?? [] };
}

export async function saveQuestion(
  question: Pick<TestQuestion, "test_id" | "owner_id" | "prompt" | "options" | "correct" | "position"> & { id?: string },
): Promise<TestQuestion> {
  const row = {
    test_id: question.test_id, owner_id: question.owner_id, prompt: question.prompt.trim(),
    options: question.options, correct: question.correct, position: question.position,
  };
  const { data, error } = question.id
    ? await supabase.from("test_questions").update(row).eq("id", question.id).select("*").single()
    : await supabase.from("test_questions").insert(row).select("*").single();
  if (error) throw error;
  return data;
}

/** Deletes a question and closes the gap, so the printed numbers and the stored order agree. */
export async function deleteQuestion(question: TestQuestion, rest: TestQuestion[]): Promise<void> {
  const { error } = await supabase.from("test_questions").delete().eq("id", question.id);
  if (error) throw error;
  const after = rest.filter((other) => other.id !== question.id);
  await Promise.all(after.map((other, position) => (other.position === position
    ? null
    : supabase.from("test_questions").update({ position }).eq("id", other.id))));
}

export async function updateTest(id: string, patch: Partial<Pick<Test, "title" | "description" | "print_layout">>): Promise<void> {
  const { error } = await supabase.from("tests").update(patch).eq("id", id);
  if (error) throw error;
}

/** Makes the printable PDF — the sheet, or the teacher's key — and opens it. */
export async function openTestPdf(testId: string, kind: "sheet" | "key", title: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("test-pdf", { body: { testId, kind } });
  if (error) await functionError(error);
  const { storagePath } = data as { storagePath: string };
  const signed = await supabase.storage.from("exports").createSignedUrl(storagePath, 300);
  if (signed.error || !signed.data) throw signed.error ?? new Error("PDF");
  const url = signed.data.signedUrl;
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const name = `${(title || "test").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "test"}${kind === "key" ? "-kalit" : ""}`;
  const { uri } = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}${name}.pdf`);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title });
  }
}

export type ScanFlag = "multiple" | "uncertain" | null;

export type ScanReading = {
  ok: true;
  answers: (number | null)[];
  flags: ScanFlag[];
  darkness: number[][];
  threshold: number;
  image: { width: number; height: number };
  corners: { x: number; y: number }[];
  bubbles: { x: number; y: number; r: number }[][];
};

export type ScanOutcome = ScanReading | { ok: false; code: string; error: string };

/**
 * Sends one photo of a filled sheet to be read on the server — the gallery,
 * the web, and the camera when reading on the phone keeps failing. The photo
 * is made 1600 px on its long side and sent as a JPEG; the reading comes back
 * in the pixels of that smaller image, which is what `uri` here shows, so the
 * overlay lines up.
 *
 * A sheet carries a child's name, so no copy is left behind: the photo itself
 * goes as soon as it is made smaller (when it is the app's own — a gallery
 * original is never touched), and the smaller one goes too unless a reading
 * came back to show over it; the screen forgets that one when the teacher is
 * done with it (`forgetPicture`).
 */
export async function scanSheet(testId: string, photoUri: string, size: { width: number; height: number }): Promise<{ outcome: ScanOutcome; uri: string }> {
  const long = Math.max(size.width, size.height);
  const resize = long > 1600
    ? [size.width >= size.height ? { resize: { width: 1600 } } : { resize: { height: 1600 } }]
    : [];
  let small: ImageManipulator.ImageResult;
  try {
    small = await ImageManipulator.manipulateAsync(photoUri, resize, {
      compress: 0.82, format: ImageManipulator.SaveFormat.JPEG, base64: true,
    });
  } finally {
    await forgetPicture(photoUri);
  }
  let shown = false;
  try {
    if (!small.base64) throw new Error("photo");
    const { data, error } = await supabase.functions.invoke("test-scan", { body: { testId, image: small.base64 } });
    if (error) await functionError(error);
    const outcome = data as ScanOutcome;
    shown = outcome.ok;
    return { outcome, uri: small.uri };
  } finally {
    if (!shown) await forgetPicture(small.uri);
  }
}

export async function saveResult(testId: string, studentName: string, answers: (number | null)[], source: "scan" | "manual"): Promise<TestResult> {
  const { data, error } = await supabase.rpc("test_save_result", {
    p_test_id: testId, p_student_name: studentName, p_answers: answers, p_source: source,
  });
  if (error) throw error;
  return data as unknown as TestResult;
}

export async function listResults(testId: string): Promise<TestResult[]> {
  const { data, error } = await supabase.from("test_results").select("*").eq("test_id", testId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function deleteResult(id: string): Promise<void> {
  const { error } = await supabase.from("test_results").delete().eq("id", id);
  if (error) throw error;
}

/** A score preview while the teacher reviews a sheet; the saved score is the database's. */
export function previewScore(questions: TestQuestion[], answers: (number | null)[]): number {
  return questions.reduce((sum, question, at) => sum + (answers[at] === question.correct ? 1 : 0), 0);
}
