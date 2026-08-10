import { corsHeaders } from "./cors.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "request_error") {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function errorResponse(error: unknown): Response {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  return json({ error: "Server operation failed", code: "internal_error" }, 500);
}

export async function bodyJson<T>(request: Request, maxBytes = 128_000): Promise<T> {
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > maxBytes) throw new HttpError(413, "Request body is too large", "payload_too_large");
  try {
    return await request.json() as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON", "invalid_json");
  }
}
