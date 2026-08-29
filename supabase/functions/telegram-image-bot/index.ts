/**
 * @JaxongirmanAppImagesBot — a one-use bridge from one JSLAYD image slot to
 * ImageResolver. Telegram never receives a presentation id, owner id or slide
 * JSON; callback data is only `is:<opaque candidate>`.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js";

import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";
import { resolveImage, resolveImageCandidates, type ResolvedCandidate } from "../_shared/image-resolver.ts";
import {
  isBlockedIp,
  safeRemoteUrl,
  TELEGRAM_IMAGE_MAX_BYTES,
  validateImageBytes,
  type ValidatedImage,
} from "../_shared/telegram-image-security.ts";

const BOT_USERNAME = "JaxongirmanAppImagesBot";
/**
 * Stamped on every automatic answer and stored with the picture.
 *
 * A deck's pictures should say which service found them, not only which index
 * they came from — otherwise "did generation actually go through the resolver"
 * is a question only the source code can answer, and source code is not
 * evidence about a deck somebody generated last week.
 */
const SERVICE_NAME = "telegram-image-bot";
const SESSION_SECONDS = 15 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALLBACK = /^is:([A-Za-z0-9_-]{16,32})$/;
const START_TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

type SessionRow = {
  id: string;
  token_hash: string;
  user_id: string;
  presentation_id: string;
  slide_id: string;
  slide_index: number;
  image_element_id: string;
  image_slot: string;
  initial_query: string | null;
  latest_query: string | null;
  intent: string | null;
  telegram_user_id: number | null;
  telegram_chat_id: number | null;
  status: "active" | "consumed" | "expired" | "cancelled";
  expires_at: string;
};

type CandidateRow = {
  opaque_id: string;
  session_id: string;
  provider: string;
  download_url: string | null;
  original_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  width: number;
  height: number;
  confidence: number;
  attribution: Record<string, unknown>;
  selected_at: string | null;
};

type TelegramUser = { id: number; first_name?: string; username?: string };
type TelegramChat = { id: number; type?: string };
type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
};
type TelegramCallback = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
};
type TelegramInline = { id: string; from: TelegramUser; query?: string; offset?: string };
type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallback;
  inline_query?: TelegramInline;
};

type ClientBody = {
  action?: "create_session" | "complete_session" | "configure_webhook" | "auto_resolve";
  presentationId?: string;
  slideId?: string;
  imageElementId?: string;
  initialQuery?: string | null;
  token?: string;
  query?: string;
  /** auto_resolve only: the deck being generated and who it belongs to. */
  ownerId?: string;
  title?: string | null;
  topic?: string | null;
  orientation?: "landscape" | "portrait" | "square" | "any";
  stylePreference?: string | null;
  slideIndex?: number;
  imageSlot?: string | null;
  /** Subjects this deck has already illustrated, so one is not repeated. */
  used?: string[];
};

type StoredCandidate = CandidateRow & { previewUrl: string; title: string };

const encoder = new TextEncoder();

function serverClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("supabase_server_environment_incomplete");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function opaque(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function secretMatches(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function isExpired(session: SessionRow): boolean {
  return session.status !== "active" || Date.parse(session.expires_at) <= Date.now();
}

function queryText(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new HttpError(400, "Rasm so‘rovini yozing.", "missing_query");
  if (text.length > 200) throw new HttpError(400, "Rasm so‘rovi juda uzun.", "query_too_long");
  return text;
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const known = [
    "missing_bot_token", "missing_webhook_secret", "invalid_image_url", "unsupported_image_protocol",
    "image_url_credentials_forbidden", "image_url_port_forbidden", "private_image_host_forbidden",
    "image_dns_unavailable", "image_download_failed", "image_download_too_large", "image_content_type_invalid",
    "image_size_invalid", "broken_or_unsupported_image", "image_content_type_mismatch", "image_dimensions_invalid",
    "candidate_missing", "session_missing", "session_expired", "cross_user", "session_consumed",
  ].find((item) => message.includes(item));
  return known ?? "telegram_image_operation_failed";
}

async function telegram(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = Deno.env.get("TELEGRAM_IMAGE_BOT_TOKEN");
  if (!token) throw new Error("missing_bot_token");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null) as { ok?: boolean; result?: Record<string, unknown> } | null;
  if (!response.ok || !result?.ok) throw new Error(`telegram_${method}_failed_${response.status}`);
  return result.result ?? {};
}

const sendMessage = (chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  telegram("sendMessage", { chat_id: chatId, text, ...extra });

async function answerCallback(callbackId: string, text: string, showAlert = false): Promise<void> {
  await telegram("answerCallbackQuery", {
    callback_query_id: callbackId,
    text,
    show_alert: showAlert,
    cache_time: 0,
  });
}

async function requirePublicDns(url: URL): Promise<void> {
  // URL syntax has already rejected private IP literals. DNS is checked too,
  // and this is repeated after every redirect.
  if (url.hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(url.hostname)) {
    if (isBlockedIp(url.hostname)) throw new Error("private_image_host_forbidden");
    return;
  }
  const lookups = await Promise.allSettled([
    Deno.resolveDns(url.hostname, "A"),
    Deno.resolveDns(url.hostname, "AAAA"),
  ]);
  const addresses = lookups.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (addresses.length === 0) throw new Error("image_dns_unavailable");
  if (addresses.some(isBlockedIp)) throw new Error("private_image_host_forbidden");
}

async function downloadRemoteImage(source: string): Promise<{ bytes: Uint8Array; image: ValidatedImage }> {
  let url = safeRemoteUrl(source);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    await requirePublicDns(url);
    const clock = new AbortController();
    const alarm = setTimeout(() => clock.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: clock.signal,
        headers: {
          Accept: "image/jpeg,image/png,image/webp",
          "User-Agent": "Jaxongirman/1.0 Telegram image importer",
        },
      });
    } catch {
      throw new Error("image_download_failed");
    } finally {
      clearTimeout(alarm);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 4) throw new Error("image_download_failed");
      url = safeRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.body) throw new Error("image_download_failed");

    const declared = response.headers.get("content-type");
    const mime = (declared ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (mime && !["image/jpeg", "image/png", "image/webp", "application/octet-stream"].includes(mime)) {
      throw new Error("image_content_type_invalid");
    }
    const announced = Number(response.headers.get("content-length") ?? 0);
    if (announced > TELEGRAM_IMAGE_MAX_BYTES) throw new Error("image_download_too_large");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > TELEGRAM_IMAGE_MAX_BYTES) {
        await reader.cancel();
        throw new Error("image_download_too_large");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    return { bytes, image: validateImageBytes(bytes, declared) };
  }
  throw new Error("image_download_failed");
}

async function imageFromCandidate(
  service: SupabaseClient,
  candidate: CandidateRow,
): Promise<{ bytes: Uint8Array; image: ValidatedImage }> {
  if (candidate.storage_bucket && candidate.storage_path) {
    if (candidate.storage_bucket !== "stock-images") throw new Error("candidate_storage_forbidden");
    const result = await service.storage.from(candidate.storage_bucket).download(candidate.storage_path);
    if (result.error || !result.data || result.data.size > TELEGRAM_IMAGE_MAX_BYTES) {
      throw new Error("image_download_failed");
    }
    const bytes = new Uint8Array(await result.data.arrayBuffer());
    return { bytes, image: validateImageBytes(bytes, result.data.type || candidate.mime_type) };
  }
  if (!candidate.download_url) throw new Error("candidate_missing");
  return await downloadRemoteImage(candidate.download_url);
}

async function activeSession(service: SupabaseClient, telegramUserId: number): Promise<SessionRow | null> {
  const result = await service
    .from("telegram_image_sessions")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as SessionRow | null;
}

async function candidatesFor(
  service: SupabaseClient,
  session: SessionRow,
  query: string,
): Promise<StoredCandidate[]> {
  if (isExpired(session)) throw new Error("session_expired");
  const element = await service
    .from("slide_elements")
    .select("id,content")
    .eq("id", session.image_element_id)
    .eq("slide_id", session.slide_id)
    .eq("presentation_id", session.presentation_id)
    .eq("owner_id", session.user_id)
    .maybeSingle();
  if (element.error || !element.data) throw new Error("session_missing");
  const content = element.data.content && typeof element.data.content === "object" && !Array.isArray(element.data.content)
    ? element.data.content as Record<string, unknown>
    : {};
  const orientation = ["landscape", "portrait", "square", "any"].includes(String(content.orientation))
    ? content.orientation as "landscape" | "portrait" | "square" | "any"
    : "landscape";
  const stylePreference = typeof content.stylePreference === "string" ? content.stylePreference : null;

  const resolved = await resolveImageCandidates(service, {
    query,
    orientation,
    stylePreference,
    title: null,
    topic: null,
  }, 6);
  session.intent = resolved.intent;

  const update = await service.from("telegram_image_sessions").update({
    latest_query: query,
    intent: resolved.intent,
    updated_at: new Date().toISOString(),
  }).eq("id", session.id).eq("status", "active");
  if (update.error) throw update.error;
  const cleared = await service.from("telegram_image_candidates").delete().eq("session_id", session.id);
  if (cleared.error) throw cleared.error;

  const rows = await Promise.all(resolved.candidates.map(async (candidate: ResolvedCandidate) => {
    const id = opaque(18);
    let previewUrl = candidate.hit.url;
    if (candidate.storagePath) {
      const signed = await service.storage.from("stock-images").createSignedUrl(candidate.storagePath, SESSION_SECONDS);
      if (signed.error || !signed.data?.signedUrl) return null;
      previewUrl = signed.data.signedUrl;
    }
    return {
      opaque_id: id,
      session_id: session.id,
      provider: candidate.provider,
      download_url: candidate.storagePath ? null : candidate.hit.url,
      original_url: candidate.hit.originalUrl ?? candidate.hit.url,
      storage_bucket: candidate.storagePath ? "stock-images" : null,
      storage_path: candidate.storagePath,
      mime_type: candidate.hit.mimeType ?? null,
      width: candidate.hit.width,
      height: candidate.hit.height,
      confidence: candidate.confidence,
      attribution: candidate.hit.attribution,
      selected_at: null,
      previewUrl,
      title: candidate.hit.attribution.title,
    } satisfies StoredCandidate;
  }));
  const kept = rows.filter((row): row is StoredCandidate => Boolean(row));
  if (kept.length > 0) {
    const insert = await service.from("telegram_image_candidates").insert(kept.map(({ previewUrl: _preview, title: _title, ...row }) => row));
    if (insert.error) throw insert.error;
  }
  return kept;
}

async function selectCandidate(
  service: SupabaseClient,
  opaqueId: string,
  telegramUserId: number,
): Promise<Record<string, unknown>> {
  const candidateResult = await service.from("telegram_image_candidates").select("*").eq("opaque_id", opaqueId).maybeSingle();
  if (candidateResult.error || !candidateResult.data) throw new Error("candidate_missing");
  const candidate = candidateResult.data as CandidateRow;
  const sessionResult = await service.from("telegram_image_sessions").select("*").eq("id", candidate.session_id).maybeSingle();
  if (sessionResult.error || !sessionResult.data) throw new Error("session_missing");
  const session = sessionResult.data as SessionRow;
  if (session.telegram_user_id !== telegramUserId) throw new Error("cross_user");
  if (session.status === "consumed") throw new Error("session_consumed");
  if (isExpired(session)) throw new Error("session_expired");
  if (candidate.selected_at) throw new Error("session_consumed");

  const downloaded = await imageFromCandidate(service, candidate);
  const path = `${session.user_id}/${session.presentation_id}/${session.slide_id}/${opaqueId}.${downloaded.image.extension}`;
  const uploaded = await service.storage.from("presentation-assets").upload(path, downloaded.bytes, {
    contentType: downloaded.image.mimeType,
    upsert: false,
  });
  if (uploaded.error) throw uploaded.error;

  const committed = await service.rpc("commit_telegram_image_selection", {
    p_session_id: session.id,
    p_candidate_id: opaqueId,
    p_telegram_user_id: telegramUserId,
    p_storage_bucket: "presentation-assets",
    p_storage_path: path,
    p_mime_type: downloaded.image.mimeType,
    p_byte_size: downloaded.bytes.byteLength,
    p_width: downloaded.image.width,
    p_height: downloaded.image.height,
  });
  if (committed.error) {
    const cleanup = await service.storage.from("presentation-assets").remove([path]);
    if (cleanup.error) console.error(JSON.stringify({ event: "telegram_image_compensation_failed", code: "storage_remove_failed" }));
    throw committed.error;
  }
  return committed.data as Record<string, unknown>;
}

async function bindSession(
  service: SupabaseClient,
  token: string,
  telegramUserId: number,
  telegramChatId: number,
): Promise<SessionRow> {
  if (!START_TOKEN.test(token)) throw new Error("session_missing");
  const bound = await service.rpc("bind_telegram_image_session", {
    p_token_hash: await sha256Hex(token),
    p_telegram_user_id: telegramUserId,
    p_telegram_chat_id: telegramChatId,
  });
  if (bound.error || !bound.data) throw new Error("session_expired");
  return bound.data as unknown as SessionRow;
}

async function showCandidates(service: SupabaseClient, session: SessionRow, query: string, chatId: number): Promise<void> {
  const rows = await candidatesFor(service, session, queryText(query));
  if (rows.length === 0) {
    await sendMessage(chatId, session.intent === "exact_person"
      ? "Bu shaxs uchun ishonchli rasm topilmadi. Noto‘g‘ri odam rasmini qo‘ymayman. Boshqa so‘rov yozing yoki /cancel bosing."
      : "Mos rasm topilmadi. Boshqa so‘rov yozing yoki /cancel bosing.");
    return;
  }
  await sendMessage(chatId, `${rows.length} ta mos rasm topildi. Slaydga qo‘shish uchun bittasini tanlang:`);
  for (const row of rows) {
    const creator = typeof row.attribution.creator === "string" ? row.attribution.creator : "";
    const license = typeof row.attribution.license === "string" ? row.attribution.license : "";
    const caption = [row.title, creator, license, `Manba: ${row.provider}`].filter(Boolean).join("\n").slice(0, 900);
    await telegram("sendPhoto", {
      chat_id: chatId,
      photo: row.previewUrl,
      caption,
      reply_markup: { inline_keyboard: [[{ text: "Tanlash", callback_data: `is:${row.opaque_id}` }]] },
    });
  }
}

async function onStart(service: SupabaseClient, message: TelegramMessage, token: string): Promise<void> {
  if (!message.from) return;
  if (message.chat.type && message.chat.type !== "private") {
    await sendMessage(message.chat.id, "Rasm tanlash havolasini bot bilan shaxsiy chatda oching.");
    return;
  }
  let session: SessionRow;
  try {
    session = await bindSession(service, token, message.from.id, message.chat.id);
  } catch {
    await sendMessage(message.chat.id, "Bu rasm tanlash havolasi eskirgan yoki allaqachon ishlatilgan. JAXONGIRMAN ilovasidan yangi havola oching.");
    return;
  }
  if (session.initial_query) await showCandidates(service, session, session.initial_query, message.chat.id);
  else await sendMessage(message.chat.id, "Qanday rasm kerak? Nomini yozing.\n\nMasalan: Registon maydoni");
}

async function onCancel(service: SupabaseClient, message: TelegramMessage): Promise<void> {
  if (!message.from) return;
  const session = await activeSession(service, message.from.id);
  if (!session) {
    await sendMessage(message.chat.id, "Faol rasm tanlash sessiyasi yo‘q.");
    return;
  }
  const cancelled = await service.from("telegram_image_sessions").update({
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", session.id).eq("status", "active");
  if (cancelled.error) throw cancelled.error;
  await sendMessage(message.chat.id, "Rasm tanlash bekor qilindi.");
}

async function onText(service: SupabaseClient, message: TelegramMessage): Promise<void> {
  if (!message.from || !message.text) return;
  const session = await activeSession(service, message.from.id);
  if (!session) {
    await sendMessage(message.chat.id, "Avval JAXONGIRMAN slayd editoridagi “Telegram orqali rasm tanlash” tugmasini bosing.");
    return;
  }
  await showCandidates(service, session, message.text, message.chat.id);
}

async function onCallback(service: SupabaseClient, callback: TelegramCallback): Promise<void> {
  const match = CALLBACK.exec(callback.data ?? "");
  if (!match) {
    await answerCallback(callback.id, "Tanlov yaroqsiz.", true);
    return;
  }
  try {
    await selectCandidate(service, match[1]!, callback.from.id);
    if (callback.message) {
      await telegram("editMessageReplyMarkup", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => ({}));
      await sendMessage(callback.message.chat.id, "✅ Rasm slaydga qo‘shildi.");
    }
    await answerCallback(callback.id, "Rasm slaydga qo‘shildi.");
  } catch (error) {
    const code = errorCode(error);
    const text = code === "cross_user"
      ? "Bu tanlov boshqa Telegram hisobiga tegishli."
      : code === "session_expired" ? "Sessiya muddati tugagan. Ilovadan yangi havola oching."
      : code === "session_consumed" ? "Bu sessiyada rasm allaqachon tanlangan."
      : "Rasm qo‘shilmadi. Qayta qidiring yoki ilovadan yangi havola oching.";
    await answerCallback(callback.id, text, true).catch(() => undefined);
  }
}

async function onInline(service: SupabaseClient, inline: TelegramInline): Promise<void> {
  const query = (inline.query ?? "").trim();
  if (!query) {
    await telegram("answerInlineQuery", { inline_query_id: inline.id, results: [], cache_time: 1, is_personal: true });
    return;
  }
  const resolved = await resolveImageCandidates(service, { query, orientation: "landscape" }, 6);
  const results = [];
  for (const candidate of resolved.candidates) {
    let url = candidate.hit.url;
    if (candidate.storagePath) {
      const signed = await service.storage.from("stock-images").createSignedUrl(candidate.storagePath, 300);
      if (!signed.data?.signedUrl) continue;
      url = signed.data.signedUrl;
    }
    results.push({
      type: "photo",
      id: (await sha256Hex(`${candidate.provider}:${url}`)).slice(0, 24),
      photo_url: url,
      thumbnail_url: url,
      title: candidate.hit.attribution.title.slice(0, 64),
      description: `${candidate.hit.attribution.creator} · ${candidate.provider}`.slice(0, 120),
      caption: `${candidate.hit.attribution.title}\n${candidate.hit.attribution.creator}\n${candidate.hit.attribution.license}`.slice(0, 900),
    });
  }
  // Inline search is intentionally stateless: it can return a photo to a chat,
  // but it has no session/candidate callback and can never mutate a slide.
  await telegram("answerInlineQuery", {
    inline_query_id: inline.id,
    results,
    cache_time: 30,
    is_personal: true,
  });
}

async function processUpdate(service: SupabaseClient, update: TelegramUpdate): Promise<void> {
  let status: "completed" | "failed" = "completed";
  let code: string | null = null;
  try {
    if (update.callback_query) await onCallback(service, update.callback_query);
    else if (update.inline_query) await onInline(service, update.inline_query);
    else if (update.message?.text) {
      const start = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?\s*$/i.exec(update.message.text);
      if (start) {
        if (start[1]) await onStart(service, update.message, start[1]);
        else await sendMessage(update.message.chat.id, "JAXONGIRMAN ilovasidan rasm tanlash havolasini oching.");
      } else if (/^\/cancel(?:@\w+)?\s*$/i.test(update.message.text)) await onCancel(service, update.message);
      else if (!update.message.text.startsWith("/")) await onText(service, update.message);
    }
  } catch (error) {
    status = "failed";
    code = errorCode(error);
    console.error(JSON.stringify({ event: "telegram_image_update_failed", update_id: update.update_id, code }));
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) await sendMessage(chatId, "Rasm botida vaqtinchalik xato yuz berdi. Birozdan so‘ng qayta urinib ko‘ring.").catch(() => undefined);
  }
  await service.from("telegram_image_updates").update({
    status,
    error_code: code,
    completed_at: new Date().toISOString(),
  }).eq("update_id", update.update_id!);
}

async function createSession(request: Request, body: ClientBody): Promise<Response> {
  const context = await requestContext(request);
  const presentationId = body.presentationId?.trim() ?? "";
  const slideId = body.slideId?.trim() ?? "";
  const imageElementId = body.imageElementId?.trim() ?? "";
  if (![presentationId, slideId, imageElementId].every((value) => UUID.test(value))) {
    throw new HttpError(400, "Taqdimot, slayd yoki rasm elementi yaroqsiz.", "invalid_target");
  }

  const [presentation, slide, element] = await Promise.all([
    context.serviceClient.from("presentations").select("id,owner_id,topic").eq("id", presentationId).eq("owner_id", context.user.id).maybeSingle(),
    context.serviceClient.from("slides").select("id,position,title").eq("id", slideId).eq("presentation_id", presentationId).eq("owner_id", context.user.id).maybeSingle(),
    context.serviceClient.from("slide_elements").select("id,type,content").eq("id", imageElementId).eq("slide_id", slideId).eq("presentation_id", presentationId).eq("owner_id", context.user.id).maybeSingle(),
  ]);
  if (presentation.error || !presentation.data || slide.error || !slide.data || element.error || !element.data) {
    throw new HttpError(404, "Rasm elementi topilmadi.", "target_not_found");
  }
  if (element.data.type !== "image") throw new HttpError(400, "Faqat rasm elementini tanlang.", "not_an_image");
  const content = element.data.content && typeof element.data.content === "object" && !Array.isArray(element.data.content)
    ? element.data.content as Record<string, unknown>
    : {};
  if (content.kind === "video") throw new HttpError(400, "Video slotiga rasm tanlab bo‘lmaydi.", "video_slot");
  const slot = typeof content.slot === "string" && content.slot.trim() ? content.slot.trim() : imageElementId;
  const provided = typeof body.initialQuery === "string" ? body.initialQuery.trim() : "";
  const initial = (provided || slide.data.title || presentation.data.topic || "").trim().slice(0, 200) || null;

  await context.serviceClient.rpc("cleanup_telegram_image_sessions");
  await context.serviceClient.from("telegram_image_sessions").update({
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", context.user.id).eq("image_element_id", imageElementId).eq("status", "active");

  const rawToken = opaque(32);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const inserted = await context.serviceClient.from("telegram_image_sessions").insert({
    token_hash: await sha256Hex(rawToken),
    user_id: context.user.id,
    presentation_id: presentationId,
    slide_id: slideId,
    slide_index: slide.data.position,
    image_element_id: imageElementId,
    image_slot: slot,
    initial_query: initial,
    expires_at: expiresAt,
  });
  if (inserted.error) throw inserted.error;
  return json({
    deepLink: `https://t.me/${BOT_USERNAME}?start=${rawToken}`,
    expiresAt,
  });
}

async function completeSession(request: Request, body: ClientBody): Promise<Response> {
  const context = await requestContext(request);
  const token = body.token?.trim() ?? "";
  const query = queryText(body.query);
  if (!START_TOKEN.test(token)) throw new HttpError(400, "Sessiya tokeni yaroqsiz.", "invalid_session_token");
  const owned = await context.serviceClient.from("telegram_image_sessions")
    .select("user_id")
    .eq("token_hash", await sha256Hex(token))
    .eq("user_id", context.user.id)
    .maybeSingle();
  if (owned.error || !owned.data) throw new HttpError(403, "Sessiya boshqa foydalanuvchiga tegishli.", "forbidden");
  const digest = await sha256Hex(context.user.id);
  const telegramUserId = 800_000_000_000 + Number.parseInt(digest.slice(0, 10), 16);
  const session = await bindSession(context.serviceClient, token, telegramUserId, telegramUserId);
  if (session.user_id !== context.user.id) throw new HttpError(403, "Sessiya boshqa foydalanuvchiga tegishli.", "forbidden");
  const candidates = await candidatesFor(context.serviceClient, session, query);
  if (!candidates[0]) throw new HttpError(422, "Mos rasm topilmadi.", "no_image");
  const result = await selectCandidate(context.serviceClient, candidates[0].opaque_id, telegramUserId);
  return json({ ok: true, result });
}

async function configureWebhook(request: Request): Promise<Response> {
  const context = await requestContext(request);
  const admin = await context.serviceClient.rpc("is_admin", { p_user_id: context.user.id });
  if (admin.error || !admin.data) throw new HttpError(403, "Forbidden", "forbidden");
  const secret = Deno.env.get("TELEGRAM_IMAGE_WEBHOOK_SECRET");
  if (!Deno.env.get("TELEGRAM_IMAGE_BOT_TOKEN")) throw new HttpError(503, "Bot token configured emas.", "missing_bot_token");
  if (!secret) throw new HttpError(503, "Webhook secret configured emas.", "missing_webhook_secret");
  const base = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  if (!base) throw new Error("supabase_url_missing");
  const webhookUrl = `${base}/functions/v1/telegram-image-bot`;
  await telegram("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query", "inline_query"],
    drop_pending_updates: false,
  });
  const info = await telegram("getWebhookInfo", {});
  return json({
    url: info.url ?? webhookUrl,
    pending_update_count: info.pending_update_count ?? null,
    last_error_message: info.last_error_message ?? null,
  });
}

/**
 * The automatic door, opened by what a caller can do rather than by what it
 * knows.
 *
 * This function is reachable without a JWT — Telegram's webhook cannot present
 * one — so the automatic action has to lock itself. The obvious lock is to
 * compare the bearer token against the service role key, and it is the wrong
 * one: the platform issues that credential in more than one format, and a
 * string comparison quietly refuses a legitimate server the day the format
 * changes. It refused ours.
 *
 * So the credential is put to work instead. Listing accounts is something only
 * the server may do; a signed-in person's token and the public key both fail
 * it. That is a fact about authority rather than about spelling, and it stays
 * true through every key rotation and format change.
 */
async function requireServerCaller(request: Request): Promise<void> {
  const offered = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("supabase_server_environment_incomplete");
  if (!offered) throw new HttpError(403, "Forbidden: no_authorization_header", "forbidden");
  const probe = createClient(url, offered, { auth: { persistSession: false, autoRefreshToken: false } });
  const allowed = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
  // The refusal names itself. An authorisation error is not secret material,
  // and a door that will not say why it is shut cannot be fixed from outside.
  if (allowed.error) throw new HttpError(403, `Forbidden: ${allowed.error.message}`, "forbidden");
}

/**
 * The generator asking for a picture, with nobody in the chat.
 *
 * Everything else this function does starts with a person: a deep link they
 * opened, a message they sent, a button they pressed. Generation has none of
 * that — an author typed a topic and is waiting — and yet the picture it needs
 * has to be found the same way, by the same resolver, with the same refusal for
 * a face nothing can prove.
 *
 * So this is the same service, entered by a different door. There is no
 * Telegram round-trip: the Bot API sends messages to people, and inventing a
 * chat with nobody in it to make the diagram symmetrical would add a network
 * hop, a token requirement and a failure mode, and would buy nothing. No bot
 * token is needed to run it, which is why generation works today and manual
 * selection is still waiting for one.
 *
 * What the automatic path does gain from living here is this function's
 * downloader — DNS-checked against private address space on every redirect,
 * size-capped while streaming, and validated by magic bytes rather than by what
 * a server claims in a header. That is stronger than what the generator used to
 * do for itself, and a deck is a public document.
 */
async function autoResolve(request: Request, body: ClientBody): Promise<Response> {
  await requireServerCaller(request);

  const ownerId = (body.ownerId ?? "").trim();
  const presentationId = (body.presentationId ?? "").trim();
  if (!UUID.test(ownerId) || !UUID.test(presentationId)) {
    throw new HttpError(400, "Taqdimot yoki egasi yaroqsiz.", "invalid_target");
  }
  const query = queryText(body.query);
  const slideIndex = Number.isSafeInteger(body.slideIndex) ? Number(body.slideIndex) : null;
  const imageSlot = typeof body.imageSlot === "string" && body.imageSlot.trim() ? body.imageSlot.trim() : null;
  const used = new Set((Array.isArray(body.used) ? body.used : []).filter((value) => typeof value === "string"));
  const where = { presentation_id: presentationId, slide_index: slideIndex, image_slot: imageSlot };

  console.log(JSON.stringify({ event: "telegram_auto_resolve_started", ...where, query_length: query.length, used: used.size }));
  const service = serverClient();

  let resolved;
  try {
    resolved = await resolveImage(service, {
      query,
      title: body.title ?? null,
      topic: body.topic ?? null,
      orientation: body.orientation ?? "landscape",
      stylePreference: body.stylePreference ?? null,
      used,
    });
  } catch (error) {
    // A resolver that fails costs the deck a picture, never the deck. The
    // caller is told plainly rather than left to time out.
    console.error(JSON.stringify({ event: "image_resolution_failed", ...where, reason: errorCode(error) }));
    return json({ status: "error", reason: errorCode(error) });
  }

  console.log(JSON.stringify({
    event: "image_resolver_result", ...where,
    status: resolved.status, intent: resolved.intent, provider: resolved.provider,
    entity: resolved.normalized, confidence: resolved.confidence, reason: resolved.reason,
  }));

  if (resolved.status === "no_image" || !resolved.hit) {
    console.log(JSON.stringify({ event: "image_no_image", ...where, intent: resolved.intent, reason: resolved.reason }));
    return json({ status: "no_image", intent: resolved.intent, entity: resolved.normalized, reason: resolved.reason });
  }

  /**
   * A confirmed picture is already in the bucket: nothing to fetch, nothing to
   * store, and the same file every time somebody asks for this subject.
   */
  if (resolved.status === "verified" && resolved.storagePath) {
    console.log(JSON.stringify({
      event: "image_selected", ...where, provider: "verified",
      intent: resolved.intent, entity: resolved.normalized,
    }));
    return json({
      status: "selected", service: SERVICE_NAME, provider: "verified", intent: resolved.intent, entity: resolved.normalized,
      bucket: "stock-images", path: resolved.storagePath,
      width: resolved.hit.width, height: resolved.hit.height,
      mimeType: null, attribution: resolved.hit.attribution,
    });
  }

  let stored;
  try {
    const { bytes, image } = await downloadRemoteImage(resolved.hit.url);
    console.log(JSON.stringify({
      event: "image_downloaded", ...where, provider: resolved.provider,
      bytes: bytes.byteLength, mime: image.mimeType, width: image.width, height: image.height,
    }));
    const path = `${ownerId}/${presentationId}/${crypto.randomUUID()}.${image.extension}`;
    const upload = await service.storage.from("stock-images").upload(path, bytes, {
      contentType: image.mimeType,
      upsert: false,
    });
    if (upload.error) throw new Error("image_store_failed");
    stored = { path, image };
  } catch (error) {
    console.error(JSON.stringify({ event: "image_resolution_failed", ...where, provider: resolved.provider, reason: errorCode(error) }));
    return json({ status: "error", reason: errorCode(error) });
  }

  console.log(JSON.stringify({
    event: "image_selected", ...where, provider: resolved.provider,
    intent: resolved.intent, entity: resolved.normalized, confidence: resolved.confidence,
  }));
  return json({
    status: "selected",
    service: SERVICE_NAME,
    provider: resolved.provider,
    intent: resolved.intent,
    entity: resolved.normalized,
    bucket: "stock-images",
    path: stored.path,
    width: stored.image.width,
    height: stored.image.height,
    mimeType: stored.image.mimeType,
    // Whatever the provider said, unchanged: a credit line the system rewrote
    // is a credit line nobody can check against the source.
    attribution: resolved.hit.attribution,
  });
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const webhookHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (webhookHeader !== null) {
      const expected = Deno.env.get("TELEGRAM_IMAGE_WEBHOOK_SECRET");
      if (!expected) return json({ error: "Webhook is not configured", code: "webhook_not_configured" }, 503);
      if (!(await secretMatches(webhookHeader, expected))) {
        return json({ error: "Forbidden", code: "invalid_webhook_secret" }, 403);
      }
      const update = await bodyJson<TelegramUpdate>(request, 256_000);
      if (!Number.isSafeInteger(update.update_id) || Number(update.update_id) < 0) {
        return json({ error: "Invalid Telegram update", code: "invalid_update" }, 400);
      }
      const service = serverClient();
      const claim = await service.rpc("claim_telegram_image_update", { p_update_id: update.update_id! });
      if (claim.error) throw claim.error;
      if (!claim.data) return json({ ok: true, duplicate: true });

      const job = processUpdate(service, update);
      const runtime = globalThis as unknown as { EdgeRuntime?: { waitUntil(task: Promise<unknown>): void } };
      if (runtime.EdgeRuntime) runtime.EdgeRuntime.waitUntil(job);
      else await job;
      void service.rpc("cleanup_telegram_image_sessions");
      return json({ ok: true });
    }

    const body = await bodyJson<ClientBody>(request, 32_000);
    if (body.action === "create_session") return await createSession(request, body);
    if (body.action === "complete_session") return await completeSession(request, body);
    if (body.action === "configure_webhook") return await configureWebhook(request);
    if (body.action === "auto_resolve") return await autoResolve(request, body);
    throw new HttpError(400, "Noma’lum amal.", "invalid_action");
  } catch (error) {
    return errorResponse(error);
  }
});
