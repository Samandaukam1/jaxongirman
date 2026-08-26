import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { GeminiWriter, ProviderUnavailable, attributionMetadata, retryable, userFacingFailure } =
  await import(`${edge}/writer.js`);

/**
 * The provider routing, tested where it can be.
 *
 * These are the rules that decide whether a paid generation survives a bad
 * afternoon at Google, and they used to decide whether it survived a zero
 * balance at OpenAI — which it did not. Every one of them is now in a module
 * that reads no environment and opens no socket, so all of it runs here.
 */

/* ------------------------------------------------------------- helpers */

const OK_TEXT = (text) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
});

const GROUNDED = (text, urls) => ({
  candidates: [{
    content: { parts: [{ text }] },
    groundingMetadata: { groundingChunks: urls.map((url) => ({ web: { uri: url, title: url } })) },
  }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
});

/** A fetch that answers from a script and records what it was asked. */
function fakeFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, grounded: Array.isArray(body.tools) });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    const answer = typeof step === "function" ? step(calls.length) : step;
    if (answer instanceof Error) throw answer;
    return {
      ok: answer.status === undefined || answer.status < 400,
      status: answer.status ?? 200,
      json: async () => answer.payload ?? answer,
    };
  };
  impl.calls = calls;
  return impl;
}

function writerWith(script, options = {}) {
  return new GeminiWriter({
    apiKey: "test-key-long-enough",
    researchModel: "gemini-3.5-flash-lite",
    writingModel: "gemini-3.5-flash-lite",
    fetchImpl: fakeFetch(script),
    sleep: async () => {},
    ...options,
  });
}

/* ------------------------------------------------- the whole point of this */

test("a dead OpenAI account cannot fail a deck, because it is never asked", async () => {
  /**
   * The regression this file exists for.
   *
   * A production deck reached twenty-eight per cent and died on "You have no
   * credits remaining". The mock below is that account: any request that is not
   * to Google throws it. A full four-stage deck is then generated — research,
   * outline, layout-aware writing and a rewrite — and the count of OpenAI calls
   * is asserted to be zero rather than merely assumed.
   */
  let openAiTextCalls = 0;
  const script = [
    GROUNDED("FAKTLAR: 2024-yilda 41% (uz.gov)", ["https://uz.gov/a"]),
    OK_TEXT(JSON.stringify({ slides: Array.from({ length: 10 }, (_, i) => ({ title: `Slayd ${i + 1}` })) })),
    OK_TEXT(JSON.stringify({ slides: Array.from({ length: 10 }, () => ({ bullets: ["a", "b", "c"] })) })),
    OK_TEXT(JSON.stringify({ slides: [{ slide: 3, fields: [{ field: "body", text: "qisqartirildi" }] }] })),
  ];

  const impl = fakeFetch(script);
  const guarded = async (url, init) => {
    if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) {
      openAiTextCalls += 1;
      throw new Error("You have no credits remaining. Please add to your billing.");
    }
    return impl(url, init);
  };

  const writer = new GeminiWriter({
    apiKey: "test-key-long-enough",
    researchModel: "gemini-3.5-flash-lite",
    writingModel: "gemini-3.5-flash-lite",
    fetchImpl: guarded,
    sleep: async () => {},
  });

  const research = await writer.research({ prompt: "mavzu" });
  const outline = await writer.structured({ prompt: "o", schemaName: "presentation_outline", schema: {} });
  const content = await writer.structured({ prompt: "c", schemaName: "presentation_content", schema: {} });
  const rewrite = await writer.structured({ prompt: "r", schemaName: "content_rewrite", schema: {} });

  assert.equal(openAiTextCalls, 0, "the text pipeline must not touch OpenAI even once");
  for (const [name, answer] of Object.entries({ research, outline, content, rewrite })) {
    assert.equal(answer.provider, "google", `${name} must be written by Google`);
    assert.equal(answer.model, "gemini-3.5-flash-lite");
  }
  assert.equal(outline.data.slides.length, 10, "a ten-slide deck is planned end to end");
  assert.equal(content.data.slides.length, 10);
  assert.equal(rewrite.data.slides[0].fields[0].text, "qisqartirildi");
});

test("the presentation text path names no OpenAI client anywhere", async () => {
  /**
   * A drift guard, not a style rule. Every one of these files called OpenAI
   * three commits ago, and a single reintroduced import would make a zero
   * balance able to fail a deck again — silently, because the fallback that
   * did it was written to look like resilience.
   */
  const { readFileSync } = await import("node:fs");
  const files = [
    "../functions/_shared/writer.ts",
    "../functions/_shared/gemini.ts",
    "../functions/_shared/pipeline.ts",
    "../functions/generate-presentation/index.ts",
    "../functions/edit-presentation/index.ts",
    // The last one to move. Games were left on OpenAI as "a different product",
    // which ignored the only thing that mattered: a zero balance belongs to the
    // account, not the pipeline.
    "../functions/generate-game/index.ts",
  ];

  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8")
      // Comments may discuss the vendor; code may not name it.
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.equal(/OpenAIClient/.test(source), false, `${file} constructs an OpenAI client`);
    assert.equal(/openai\s*\./.test(source), false, `${file} calls an OpenAI method`);
    assert.equal(/api\.openai\.com/.test(source), false, `${file} reaches OpenAI directly`);
  }
});

test("every request goes to generativelanguage.googleapis.com and nowhere else", async () => {
  const impl = fakeFetch([GROUNDED("notes", []), OK_TEXT("{}")]);
  const writer = new GeminiWriter({
    apiKey: "test-key-long-enough",
    researchModel: "gemini-3.5-flash-lite",
    writingModel: "gemini-3.5-flash-lite",
    fetchImpl: impl,
    sleep: async () => {},
  });

  await writer.research({ prompt: "x" });
  await writer.structured({ prompt: "y", schemaName: "s", schema: {} });

  assert.equal(impl.calls.length, 2);
  for (const call of impl.calls) {
    assert.match(call.url, /^https:\/\/generativelanguage\.googleapis\.com\//);
    assert.equal(/api\.openai\.com/.test(call.url), false);
  }
});

/* ------------------------------------------------------------- research */

test("grounded search returns the pages it actually cited", async () => {
  const writer = writerWith([GROUNDED("FAKTLAR", ["https://uz.gov/a", "https://uz.gov/b"])]);
  const answer = await writer.research({ prompt: "mavzu" });

  assert.equal(answer.groundedSearch, true);
  assert.equal(answer.citations.length, 2);
  assert.equal(answer.attempts, 1);
  assert.deepEqual(attributionMetadata(answer), { attempts: 1, grounded_search: true });
});

test("when search will not work the model answers from memory, and says so", async () => {
  /**
   * The rule that replaced the OpenAI fallback.
   *
   * Search failing is common — a region without the tool, an exhausted search
   * quota — and it is not a reason to throw away a deck somebody paid for. The
   * ungrounded answer is worth less and is labelled as worth less, which is the
   * part the old fallback never did.
   */
  const writer = writerWith([(call) =>
    call <= 3 ? { status: 429, payload: { error: { message: "search quota exhausted" } } } : OK_TEXT("model bilimidan")]);

  const answer = await writer.research({ prompt: "mavzu" });

  assert.equal(answer.provider, "google", "still Google — never another vendor");
  assert.equal(answer.groundedSearch, false);
  assert.equal(answer.text, "model bilimidan");
  assert.deepEqual(answer.citations, []);
  assert.deepEqual(attributionMetadata(answer), {
    attempts: 1, grounded_search: false, fallback_mode: "gemini_model_knowledge",
  });
});

test("the ungrounded retry drops the search tool rather than repeating it", async () => {
  const impl = fakeFetch([
    { status: 503, payload: {} }, { status: 503, payload: {} }, { status: 503, payload: {} },
    OK_TEXT("from memory"),
  ]);
  const writer = new GeminiWriter({
    apiKey: "test-key-long-enough", researchModel: "m", writingModel: "m",
    fetchImpl: impl, sleep: async () => {},
  });

  await writer.research({ prompt: "x" });

  assert.deepEqual(impl.calls.map((call) => call.grounded), [true, true, true, false]);
});

test("Gemini down completely is a provider failure, not a silent empty deck", async () => {
  const writer = writerWith([{ status: 503, payload: { error: { message: "backend overloaded" } } }]);
  await assert.rejects(
    () => writer.research({ prompt: "x" }),
    (error) => error instanceof ProviderUnavailable && error.reason === "http_503",
  );
});

/* ----------------------------------------------------------- structured */

test("a rate limit is retried and then succeeds", async () => {
  const writer = writerWith([(call) =>
    call === 1 ? { status: 429, payload: {} } : OK_TEXT(JSON.stringify({ slides: [] }))]);

  const answer = await writer.structured({ prompt: "x", schemaName: "outline", schema: {} });
  assert.equal(answer.attempts, 2);
  assert.deepEqual(attributionMetadata(answer), { attempts: 2 });
});

test("a rejected schema is not retried, because retrying cannot help", async () => {
  /**
   * This is the fault that used to reach OpenAI. A 400 means the request we
   * built is wrong; three more identical requests are three more 400s, and the
   * old code answered it by spending money at another vendor instead of
   * surfacing it.
   */
  const impl = fakeFetch([{ status: 400, payload: { error: { message: "Invalid JSON payload" } } }]);
  const writer = new GeminiWriter({
    apiKey: "test-key-long-enough", researchModel: "m", writingModel: "m",
    fetchImpl: impl, sleep: async () => {},
  });

  await assert.rejects(
    () => writer.structured({ prompt: "x", schemaName: "outline", schema: {} }),
    (error) => error instanceof ProviderUnavailable && error.reason === "http_400",
  );
  assert.equal(impl.calls.length, 1, "asked once, not four times");
});

test("an answer that is not the JSON it was asked for is retried, not parsed around", async () => {
  const writer = writerWith([(call) =>
    call === 1 ? OK_TEXT("Mana natija: {broken") : OK_TEXT(JSON.stringify({ ok: true }))]);

  const answer = await writer.structured({ prompt: "x", schemaName: "outline", schema: {} });
  assert.deepEqual(answer.data, { ok: true });
  assert.equal(answer.attempts, 2);
});

test("an unset key fails immediately and by name", async () => {
  const writer = new GeminiWriter({ apiKey: "", researchModel: "m", writingModel: "m" });
  assert.equal(writer.configured, false);
  await assert.rejects(
    () => writer.structured({ prompt: "x", schemaName: "s", schema: {} }),
    (error) => error instanceof ProviderUnavailable && error.reason === "not_configured",
  );
});

test("attached files ride inline, in the same request", async () => {
  const impl = fakeFetch([OK_TEXT("{}")]);
  const writer = new GeminiWriter({
    apiKey: "test-key-long-enough", researchModel: "m", writingModel: "m",
    fetchImpl: impl, sleep: async () => {},
  });

  await writer.structured({
    prompt: "x", schemaName: "s", schema: {},
    attachments: [{ mimeType: "application/pdf", data: "QUJD" }],
  });

  const parts = impl.calls[0].body.contents[0].parts;
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[1], { inline_data: { mime_type: "application/pdf", data: "QUJD" } });
});

/* ------------------------------------------------------ Gemini 3.x shape */

test("no sampling parameter is ever sent", async () => {
  /**
   * `temperature`, `topP` and `topK` are deprecated on Gemini 3.x: ignored now,
   * and a later generation answers a request carrying one with an HTTP 400.
   *
   * A 400 is not retryable and there is no second provider behind this one, so
   * a stray knob would not make decks slightly worse — it would stop them. That
   * is worth a test rather than a comment, because the tempting fix for "the
   * copy feels samey" is to reach for exactly this.
   */
  const impl = fakeFetch([GROUNDED("notes", []), OK_TEXT("{}")]);
  const writer = new GeminiWriter({
    apiKey: "test-key-long-enough", researchModel: "m", writingModel: "m",
    fetchImpl: impl, sleep: async () => {},
  });

  await writer.research({ prompt: "x" });
  await writer.structured({ prompt: "y", schemaName: "s", schema: {} });

  for (const call of impl.calls) {
    const config = call.body.generationConfig ?? {};
    for (const banned of ["temperature", "topP", "topK", "top_p", "top_k", "candidateCount", "candidate_count"]) {
      assert.equal(banned in config, false, `${banned} must not be sent to a Gemini 3.x model`);
    }
    assert.ok(config.maxOutputTokens > 0, "the one limit that is still ours to set survives");
  }
});

test("the default models are the generation the pricing table knows about", async () => {
  /**
   * The default and the price live in two files that nothing links, so a model
   * bumped in one and forgotten in the other logs every deck at zero cost. This
   * reads the real default out of the factory and the real rate out of the real
   * migration.
   */
  const { readFileSync } = await import("node:fs");
  const factory = readFileSync(new URL("../functions/_shared/gemini.ts", import.meta.url), "utf8");

  const models = [...factory.matchAll(/\?\?\s*"(gemini-[\w.-]+)"/g)].map((match) => match[1]);
  assert.equal(models.length, 2, "a research default and a writing default");

  const migrations = readFileSync(new URL("../migrations/202608170011_gemini_35_pricing.sql", import.meta.url), "utf8")
    + readFileSync(new URL("../migrations/202608170002_gemini_pricing.sql", import.meta.url), "utf8");

  for (const model of models) {
    assert.ok(migrations.includes(`'${model}'`), `${model} has no price, so its decks would cost zero`);
  }
});

/* -------------------------------------------------------------- retries */

test("only faults that another try could fix are retried", () => {
  for (const reason of ["rate_limited", "network", "empty_response", "malformed_json", "http_500", "http_503"]) {
    assert.equal(retryable(reason), true, `${reason} should be retried`);
  }
  for (const reason of ["http_400", "http_401", "http_403", "http_404", "not_configured"]) {
    assert.equal(retryable(reason), false, `${reason} is permanent — retrying is a slower failure`);
  }
});

/* ------------------------------------------------------------ the phone */

test("a provider's billing sentence never reaches the author", () => {
  /**
   * The exact string a customer saw. It names our account and our vendor,
   * neither of which the author can do anything about.
   */
  const raw = new Error("You have no credits remaining. Please add to your billing at platform.openai.com.");
  const shown = userFacingFailure(raw);

  assert.equal(/credits|billing|openai/i.test(shown.message), false, "no vendor, no balance, no URL");
  assert.equal(shown.message, "AI xizmati vaqtincha javob bermadi. Iltimos, birozdan keyin qayta urinib ko‘ring.");
  assert.equal(shown.code, "provider_unavailable:billing", "the code still says what happened, for the log");
});

test("a provider outage is sanitised, and its reason survives as a code", () => {
  const shown = userFacingFailure(new ProviderUnavailable("http_503", "backend overloaded: request id 7f3a"));
  assert.equal(shown.code, "provider_unavailable:http_503");
  assert.equal(/overloaded|7f3a/.test(shown.message), false);
});

test("a missing key tells an admin something an admin can act on", () => {
  const shown = userFacingFailure(new ProviderUnavailable("not_configured", "GEMINI_API_KEY is not set"));
  assert.equal(shown.code, "provider_not_configured");
  assert.equal(/GEMINI_API_KEY/.test(shown.message), false, "never name the variable on a phone");
});

test("a failure the author can fix is still told to them plainly", () => {
  const shown = userFacingFailure(new Error("Tanlangan dizayn topilmadi yoki nashr qilinmagan."));
  assert.equal(shown.code, "pipeline_failed");
  assert.match(shown.message, /dizayn/);
});

/* ---------------------------------------------- what a schema may contain */

test("no schema the pipeline sends contains an array of arrays", async () => {
  /**
   * The construct that broke slide copy.
   *
   * Every request carrying it was refused while the outline request — the same
   * shape but for this — went through every time, and a probe containing
   * nothing else took longer than fifteen seconds to answer a three-cell
   * example. A table row is an object holding its cells now, unwrapped the
   * moment the answer is parsed.
   *
   * Guarded rather than remembered: the nested form is the natural way to
   * write a table, so it will be reached for again.
   */
  const { contentSchema, outlineSchema, rewriteSchema, editorOperationsSchema } =
    await import(`${edge}/plan-schema.js`);
  const { toGeminiSchema } = await import(`${edge}/gemini-schema.js`);

  const nested = (node, path = "$") => {
    if (Array.isArray(node)) return node.flatMap((entry, index) => nested(entry, `${path}[${index}]`));
    if (!node || typeof node !== "object") return [];
    const found = node.type === "array" && node.items?.type === "array" ? [path] : [];
    return [...found, ...Object.entries(node).flatMap(([key, value]) => nested(value, `${path}.${key}`))];
  };

  for (const [name, schema] of Object.entries({
    presentation_outline: outlineSchema(10),
    presentation_content: contentSchema(10),
    content_rewrite: rewriteSchema(),
    editor_operations: editorOperationsSchema,
  })) {
    assert.deepEqual(nested(toGeminiSchema(schema)), [], `${name} nests an array inside an array`);
  }
});

/* ------------------------------------------------------------- timeouts */

test("a request that never answers is abandoned, not waited on for ever", async () => {
  /**
   * The regression this whole exercise came from.
   *
   * `fetch` had no signal, so a connection that never replied blocked the call,
   * which blocked `mapWithConcurrency`, which blocked the stage — and the job
   * sat at `writing_content` with the author's credits reserved and nothing on
   * screen ever changing. A deck that fails is recoverable. One that hangs is
   * not: nothing releases the reservation and nothing tells the author.
   *
   * The fake never resolves on its own; only the abort ends it, so if the
   * signal were dropped this test would hang rather than fail — which is the
   * honest shape for a test about hanging.
   */
  let aborted = false;
  const hang = async (_url, init) => {
    await new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    });
  };

  const writer = new GeminiWriter({
    apiKey: "test-key-long-enough",
    researchModel: "m", writingModel: "m",
    fetchImpl: hang,
    sleep: async () => {},
    timeoutMs: 40,
  });

  const started = Date.now();
  await assert.rejects(
    () => writer.structured({ prompt: "x", schemaName: "s", schema: { type: "object", properties: {} }, attempts: 1 }),
    (error) => {
      // Reported as a timeout with the limit named, not as a generic network
      // fault: one is worth investigating and the other is worth retrying.
      assert.equal(error.reason, "timeout");
      assert.match(error.message, /40s|0s/);
      return true;
    },
  );
  assert.ok(aborted, "the request was never actually aborted");
  assert.ok(Date.now() - started < 5000, "it waited far longer than the timeout");
});

test("a timeout is retried, and the retries are bounded", async () => {
  let calls = 0;
  const hang = async (_url, init) => {
    calls += 1;
    await new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  };

  const writer = new GeminiWriter({
    apiKey: "test-key-long-enough",
    researchModel: "m", writingModel: "m",
    fetchImpl: hang,
    sleep: async () => {},
    timeoutMs: 20,
  });

  await assert.rejects(() => writer.structured({
    prompt: "x", schemaName: "s", schema: { type: "object", properties: {} }, attempts: 3,
  }));
  // Three, not four and not for ever. An unbounded retry over a provider that
  // is not answering is the same hang wearing a different hat.
  assert.equal(calls, 3);
});

test("a slow answer that arrives inside the limit is kept", async () => {
  const late = async (_url, _init) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true, status: 200, json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: true }) }] } }],
      usageMetadata: {},
    }) };
  };

  const writer = new GeminiWriter({
    apiKey: "test-key-long-enough",
    researchModel: "m", writingModel: "m",
    fetchImpl: late,
    sleep: async () => {},
    timeoutMs: 3000,
  });

  const answer = await writer.structured({ prompt: "x", schemaName: "s", schema: { type: "object", properties: {} } });
  assert.deepEqual(answer.data, { ok: true });
});
