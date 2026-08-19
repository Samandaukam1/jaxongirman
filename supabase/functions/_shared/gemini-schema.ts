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
  "type", "format", "description", "nullable", "enum", "anyOf",
  "items", "properties", "required", "minItems", "maxItems", "propertyOrdering",
]);

export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;

  const source = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let union: Record<string, unknown>[] | null = null;

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

    if (key === "anyOf" && Array.isArray(value)) {
      union = value as Record<string, unknown>[];
      continue;
    }

    out[key] = toGeminiSchema(value);
  }

  /**
   * `anyOf: [X, { type: "null" }]` is how OpenAI's strict mode says "an X or
   * nothing", and it is the only way it can say it — strict mode has no
   * `nullable`. Gemini has `nullable` and no `type: "null"`, so the same
   * promise has to be re-stated rather than passed along.
   *
   * Dropping it instead, which is what happened before this existed, turned
   * four properties of the slide schema into `{}`. An empty schema is not a
   * loose schema, it is an invalid one: Gemini answered the whole request with
   * an HTTP 400, every deck failed at the writing stage, and because the old
   * code read a 400 as "try the other vendor" the bill went to OpenAI and the
   * cause stayed hidden for as long as that account had money in it.
   */
  if (union) {
    const real = union.filter((member) => member?.type !== "null");
    const nullable = real.length !== union.length;

    if (real.length === 1) {
      // One member and null: the member, marked nullable. Anything the wrapper
      // said for itself — a description, usually — outranks the member's copy.
      const collapsed = toGeminiSchema(real[0]) as Record<string, unknown>;
      for (const [key, value] of Object.entries(collapsed)) {
        if (!(key in out)) out[key] = value;
      }
    } else if (real.length > 1) {
      // A genuine union. Gemini understands `anyOf` itself; it was only ever
      // the null member it could not read.
      out.anyOf = real.map(toGeminiSchema);
    }
    if (nullable) out.nullable = true;
  }

  return out;
}

/**
 * Refuses a schema here rather than letting Google refuse it.
 *
 * `toGeminiSchema` drops what it does not recognise, which is the right
 * behaviour and an easy thing to trust too far: a key it forgets to drop
 * travels to Gemini and comes back as "Request contains an invalid argument",
 * with no field named and no way to tell which of a hundred nodes was meant.
 *
 * So the output is checked before it is sent. A failure here names the path and
 * the key, costs no network call, and happens in a test rather than in
 * somebody's deck.
 */
const GEMINI_KEYS = new Set([
  "type", "format", "description", "nullable", "enum", "anyOf",
  "items", "properties", "required", "minItems", "maxItems", "propertyOrdering",
]);

const GEMINI_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean"]);

export type SchemaProblem = { path: string; problem: string };

export function geminiSchemaProblems(schema: unknown, path = "$"): SchemaProblem[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((entry, index) => geminiSchemaProblems(entry, `${path}[${index}]`));
  }
  if (!schema || typeof schema !== "object") return [];

  const node = schema as Record<string, unknown>;
  const problems: SchemaProblem[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (!GEMINI_KEYS.has(key)) {
      problems.push({ path: `${path}.${key}`, problem: `Gemini bu kalitni bilmaydi: \`${key}\`` });
      continue;
    }

    if (key === "type") {
      if (typeof value !== "string" || !GEMINI_TYPES.has(value)) {
        problems.push({ path: `${path}.type`, problem: `noma'lum tur: ${JSON.stringify(value)}` });
      }
      continue;
    }

    // A properties map is a bag of schemas, not a schema, so its keys are names
    // rather than keywords.
    if (key === "properties" && value && typeof value === "object") {
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        problems.push(...geminiSchemaProblems(child, `${path}.properties.${name}`));
      }
      continue;
    }

    if (key === "enum") {
      if (!Array.isArray(value) || value.length === 0) {
        problems.push({ path: `${path}.enum`, problem: "enum bo'sh yoki massiv emas" });
      }
      continue;
    }

    if (key === "required") {
      const names = Array.isArray(value) ? value : [];
      const declared = Object.keys((node.properties ?? {}) as Record<string, unknown>);
      for (const name of names) {
        if (!declared.includes(String(name))) {
          problems.push({ path: `${path}.required`, problem: `"${name}" required, lekin properties'da yo'q` });
        }
      }
      continue;
    }

    problems.push(...geminiSchemaProblems(value, `${path}.${key}`));
  }

  if (node.type === "array" && node.items === undefined) {
    problems.push({ path, problem: "array, lekin items yo'q" });
  }
  if (node.type === "object" && node.properties === undefined) {
    problems.push({ path, problem: "object, lekin properties yo'q" });
  }

  return problems;
}
