/**
 * A JSON Schema, narrowed to the subset Gemini accepts.
 *
 * Gemini's `responseSchema` is an OpenAPI 3 subset: no `additionalProperties`,
 * no union `type` arrays, no `$schema`. The schemas in `plan-schema.ts` are
 * written for OpenAI's strict mode and use all three.
 *
 * Keeping two copies of every schema would mean two things to edit and one of
 * them quietly ceasing to match what the renderer expects. The OpenAI schema
 * stays the single definition; this narrows it on the way out.
 *
 * Separate from `gemini.ts` because that file reaches for `Deno.env` and so can
 * only be checked by a Deno toolchain, which no machine in this repo has. This
 * half is the half worth testing, so it lives where it can be.
 */

/** Recognised by Gemini; anything else is dropped rather than passed through. */
const ALLOWED = new Set([
  "type", "format", "description", "nullable", "enum",
  "items", "properties", "required", "minItems", "maxItems", "propertyOrdering",
]);

export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;

  const source = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!ALLOWED.has(key)) continue;

    // `["string", "null"]` is the same promise as a nullable string, said in
    // the vocabulary Gemini has.
    if (key === "type" && Array.isArray(value)) {
      const types = value.filter((entry) => entry !== "null");
      out.type = types[0] ?? "string";
      if (types.length !== value.length) out.nullable = true;
      continue;
    }

    if (key === "properties" && value && typeof value === "object") {
      const properties: Record<string, unknown> = {};
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        properties[name] = toGeminiSchema(child);
      }
      out.properties = properties;
      continue;
    }

    out[key] = toGeminiSchema(value);
  }

  return out;
}

/**
 * Failures worth answering by trying the other provider.
 *
 * A timeout, a rate limit, an outage, an answer that is not the JSON it was
 * asked for. Not a request this code built wrongly — OpenAI would refuse that
 * the same way, and falling back would hide it.
 */
export function fallbackReason(error: { name?: string; reason?: string; message?: string } | null | undefined): string | null {
  if (!error) return null;
  if (error.name === "GeminiUnavailable" && typeof error.reason === "string") return error.reason;
  if (typeof error.message === "string" && /timeout|aborted|network|fetch failed/i.test(error.message)) return "network";
  return null;
}
