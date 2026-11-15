/**
 * "Kutubxonaga qo‘shish" on a deck, game or scientific work shared in a chat.
 *
 * The rows are copied by `chat_library_copy` in one transaction (the caller
 * must be in the conversation; a second tap gives the same copy); this then
 * copies the stored files the copy now names — pictures in the sender's
 * folders, into the receiver's — so the copy keeps working whatever the
 * author later deletes.
 */
import { requestContext } from "../_shared/auth.ts";
import { preflight } from "../_shared/cors.ts";
import { bodyJson, errorResponse, HttpError, json } from "../_shared/http.ts";

type Body = { messageId?: string };
type CopyFile = { bucket: string; from: string; to: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);

  try {
    const context = await requestContext(request);
    const body = await bodyJson<Body>(request, 2_000);
    const messageId = (body.messageId ?? "").trim();
    if (!UUID.test(messageId)) throw new HttpError(400, "Xabar tanlanmadi.", "invalid_id");

    const service = context.serviceClient;
    const copied = await service.rpc("chat_library_copy", { p_message_id: messageId, p_user: context.user.id });
    if (copied.error) {
      if (copied.error.code === "P0002") {
        const gone = /o‘chirgan/.test(copied.error.message);
        throw new HttpError(404, gone ? "Muallif bu ishni o‘chirgan." : "Xabar topilmadi.", gone ? "item_gone" : "message_not_found");
      }
      throw copied.error;
    }
    const result = copied.data as { kind: string; id: string; files: CopyFile[] };

    // A few at a time: a deck can name dozens of pictures.
    const files = [...(result.files ?? [])];
    let failed = 0;
    const worker = async () => {
      for (let file = files.shift(); file; file = files.shift()) {
        const { error } = await service.storage.from(file.bucket).copy(file.from, file.to);
        if (error && !/exists/i.test(error.message)) failed += 1;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    console.log(JSON.stringify({ event: "chat_library_copy", kind: result.kind, files: result.files?.length ?? 0, failed }));

    return json({ kind: result.kind, id: result.id });
  } catch (error) {
    return errorResponse(error);
  }
});
