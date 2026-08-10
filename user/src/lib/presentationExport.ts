import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { asFunctionErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

export type PresentationExportFormat = "pdf" | "pptx";
export type ExportPhase = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type PresentationExportJob = {
  id: string;
  presentation_id: string;
  format: PresentationExportFormat;
  status: ExportPhase;
  progress: number;
  storage_path: string | null;
  size_bytes: number | null;
  file_name: string | null;
  error_message: string | null;
  expires_at: string | null;
};

export type DownloadedPresentationExport = {
  jobId: string;
  format: PresentationExportFormat;
  fileName: string;
  mimeType: string;
  uri: string;
  sizeBytes: number | null;
  objectUrl: boolean;
};

type ProgressCallbacks = {
  onGenerationProgress?: (value: number) => void;
  onDownloadProgress?: (value: number) => void;
};

const SIGNED_URL_SECONDS = 60 * 60;

function mimeType(format: PresentationExportFormat): string {
  return format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

function fallbackFileName(title: string, format: PresentationExportFormat): string {
  const stem = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120).toLowerCase() || "presentation";
  return `${stem}.${format}`;
}

function abortError(): Error {
  const error = new Error("Eksport bekor qilindi");
  error.name = "AbortError";
  return error;
}

function asJob(value: unknown): PresentationExportJob | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.presentation_id !== "string") return null;
  if (row.format !== "pdf" && row.format !== "pptx") return null;
  if (!["queued", "running", "succeeded", "failed", "cancelled"].includes(String(row.status))) return null;
  return {
    id: row.id,
    presentation_id: row.presentation_id,
    format: row.format,
    status: row.status as ExportPhase,
    progress: typeof row.progress === "number" ? row.progress : 0,
    storage_path: typeof row.storage_path === "string" ? row.storage_path : null,
    size_bytes: typeof row.size_bytes === "number" ? row.size_bytes : null,
    file_name: typeof row.file_name === "string" ? row.file_name : null,
    error_message: typeof row.error_message === "string" ? row.error_message : null,
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
  };
}

async function waitForJob(
  jobId: string,
  signal: AbortSignal,
  onProgress?: (value: number) => void,
): Promise<PresentationExportJob> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    let polling = false;

    const cleanup = () => {
      clearInterval(timer);
      signal.removeEventListener("abort", onAbort);
      void supabase.removeChannel(channel);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const accept = (value: unknown) => {
      const job = asJob(value);
      if (!job || job.id !== jobId) return;
      onProgress?.(Math.max(0, Math.min(1, job.progress / 100)));
      if (job.status === "succeeded") {
        if (!job.storage_path) finish(() => reject(new Error("Eksport fayli topilmadi")));
        else finish(() => resolve(job));
      } else if (job.status === "failed" || job.status === "cancelled") {
        finish(() => reject(new Error(job.error_message ?? "Eksport amalga oshmadi")));
      }
    };
    const poll = async () => {
      if (settled || polling) return;
      polling = true;
      const result = await supabase.from("export_jobs").select("*").eq("id", jobId).maybeSingle();
      polling = false;
      if (settled) return;
      if (result.error) {
        finish(() => reject(result.error));
        return;
      }
      if (result.data) accept(result.data);
    };
    const onAbort = () => finish(() => reject(abortError()));
    const channel = supabase
      .channel(`export-job-${jobId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "export_jobs", filter: `id=eq.${jobId}` }, (payload) => accept(payload.new))
      .subscribe();
    const timer = setInterval(() => { void poll(); }, 1_250);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    else void poll();
  });
}

async function signedDownloadUrl(job: PresentationExportJob, fileName: string): Promise<string> {
  if (!job.storage_path) throw new Error("Eksport fayli topilmadi");
  const result = await supabase.storage.from("exports").createSignedUrl(job.storage_path, SIGNED_URL_SECONDS, { download: fileName });
  if (result.error || !result.data?.signedUrl) throw result.error ?? new Error("Yuklab olish havolasi olinmadi");
  return result.data.signedUrl;
}

async function downloadNative(
  job: PresentationExportJob,
  fileName: string,
  url: string,
  onProgress?: (value: number) => void,
): Promise<DownloadedPresentationExport> {
  if (!FileSystem.cacheDirectory) throw new Error("Qurilma xotirasi mavjud emas");
  const target = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  const resumable = FileSystem.createDownloadResumable(url, target, {}, (update) => {
    const total = update.totalBytesExpectedToWrite;
    if (total > 0) onProgress?.(Math.max(0, Math.min(1, update.totalBytesWritten / total)));
  });
  const result = await resumable.downloadAsync();
  if (!result?.uri) throw new Error("Fayl yuklab olinmadi");
  onProgress?.(1);
  return { jobId: job.id, format: job.format, fileName, mimeType: mimeType(job.format), uri: result.uri, sizeBytes: job.size_bytes, objectUrl: false };
}

async function downloadWeb(
  job: PresentationExportJob,
  fileName: string,
  url: string,
  onProgress?: (value: number) => void,
): Promise<DownloadedPresentationExport> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Fayl yuklab olinmadi");
  const blob = await response.blob();
  onProgress?.(1);
  return { jobId: job.id, format: job.format, fileName, mimeType: mimeType(job.format), uri: URL.createObjectURL(blob), sizeBytes: blob.size, objectUrl: true };
}

export async function createPresentationExport(
  presentationId: string,
  presentationTitle: string,
  format: PresentationExportFormat,
  callbacks: ProgressCallbacks,
  signal: AbortSignal,
): Promise<DownloadedPresentationExport> {
  if (signal.aborted) throw abortError();
  callbacks.onGenerationProgress?.(0);
  const invoked = await supabase.functions.invoke("export-presentation", { body: { presentationId, format } });
  if (invoked.error) throw new Error(await asFunctionErrorMessage(invoked.error));
  const jobId = (invoked.data as { jobId?: unknown } | null)?.jobId;
  if (typeof jobId !== "string") throw new Error("Eksport vazifasi yaratilmadi");
  const job = await waitForJob(jobId, signal, callbacks.onGenerationProgress);
  if (signal.aborted) throw abortError();
  const fileName = job.file_name ?? fallbackFileName(presentationTitle, format);
  const url = await signedDownloadUrl(job, fileName);
  callbacks.onDownloadProgress?.(0);
  return Platform.OS === "web"
    ? await downloadWeb(job, fileName, url, callbacks.onDownloadProgress)
    : await downloadNative(job, fileName, url, callbacks.onDownloadProgress);
}

function triggerWebDownload(file: DownloadedPresentationExport) {
  const anchor = document.createElement("a");
  anchor.href = file.uri;
  anchor.download = file.fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function openPresentationExport(file: DownloadedPresentationExport): Promise<void> {
  if (Platform.OS === "web") {
    window.open(file.uri, "_blank", "noopener,noreferrer");
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("Fayl ochish oynasi mavjud emas");
  await Sharing.shareAsync(file.uri, {
    mimeType: file.mimeType,
    UTI: file.format === "pdf" ? "com.adobe.pdf" : "org.openxmlformats.presentationml.presentation",
    dialogTitle: file.format === "pdf" ? "PDF faylni ochish" : "PowerPoint faylni ochish",
  });
}

export async function savePresentationExport(file: DownloadedPresentationExport): Promise<void> {
  if (Platform.OS === "web") {
    triggerWebDownload(file);
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("Faylni saqlash oynasi mavjud emas");
  await Sharing.shareAsync(file.uri, {
    mimeType: file.mimeType,
    UTI: file.format === "pdf" ? "com.adobe.pdf" : "org.openxmlformats.presentationml.presentation",
    dialogTitle: "Faylni saqlash",
  });
}

export async function sharePresentationExport(file: DownloadedPresentationExport): Promise<void> {
  if (Platform.OS === "web" && navigator.share) {
    const blob = await (await fetch(file.uri)).blob();
    const sharedFile = new File([blob], file.fileName, { type: file.mimeType });
    if (!navigator.canShare || navigator.canShare({ files: [sharedFile] })) {
      await navigator.share({ title: file.fileName, files: [sharedFile] });
      return;
    }
  }
  if (Platform.OS === "web") {
    triggerWebDownload(file);
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("Ulashish oynasi mavjud emas");
  await Sharing.shareAsync(file.uri, {
    mimeType: file.mimeType,
    UTI: file.format === "pdf" ? "com.adobe.pdf" : "org.openxmlformats.presentationml.presentation",
    dialogTitle: "Taqdimotni ulashish",
  });
}

export function releasePresentationExport(file: DownloadedPresentationExport | null): void {
  if (file?.objectUrl && Platform.OS === "web") URL.revokeObjectURL(file.uri);
}

