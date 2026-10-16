import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

/**
 * The Liquid Glass engine's promises, held under load.
 *
 * The one that matters most is the one a person sees: no words on top of
 * words, none off the slide, none running out of their card, none over a
 * photograph. It is checked here across hundreds of decks built from hostile
 * content — sentences five times longer than asked for, words longer than a
 * column, empty fields, every kind of page, every mood — because a layout
 * that is right for the sample deck and wrong for the four-hundredth real one
 * is a layout that is wrong.
 */

const edge = buildEdgeModules();
const { buildDNA, readArtDirection, MOODS, candidateFaces } = await import(`${edge}/glass/dna.js`);
const { composeDeck, pageFaults } = await import(`${edge}/glass/compose.js`);
const { readOutline, readSlide, SLIDE_KINDS, varyKinds } = await import(`${edge}/glass/content.js`);
const { normalizeUz, fit, textWidth } = await import(`${edge}/glass/text.js`);
const { contrast, oklch } = await import(`${edge}/glass/color.js`);
const { W, H, intersects: touches } = await import(`${edge}/glass/backdrop.js`);
const { ICON_NAMES, pickIcon, iconVector } = await import(`${edge}/glass/icons.js`);

/** A deterministic stream, so a failure names the seed that reproduces it. */
function stream(seed) {
  let state = seed >>> 0 || 7;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

const WORDS = ("sun’iy intellekt ta’lim o‘qituvchi talaba algoritm tahlil natija jarayon bosqich raqamli texnologiya "
  + "tadqiqot samaradorlik yondashuv innovatsiya muammo yechim tizim rivojlanish iqtisodiyot jamiyat madaniyat "
  + "tarix adabiyot Navoiy O‘zbekiston respublikasi xalqaro hamkorlik g‘oya mas’uliyat 2024-yil 37% 1,2 mln").split(" ");

function sentence(next, min, max) {
  const count = min + Math.floor(next() * (max - min + 1));
  const words = Array.from({ length: count }, () => WORDS[Math.floor(next() * WORDS.length)]);
  if (next() < 0.06) words.push("Ozbekistonrespublikasiningqishloqxojaligivazirligi"); // a word wider than a column
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

function hostileSlide(next, kind) {
  const long = next() < 0.3;
  const points = Array.from({ length: 2 + Math.floor(next() * 5) }, () => ({
    title: sentence(next, 1, long ? 9 : 4),
    text: sentence(next, 4, long ? 60 : 18),
  }));
  return {
    eyebrow: next() < 0.2 ? "" : sentence(next, 1, 3),
    title: sentence(next, 3, long ? 26 : 10),
    lead: next() < 0.2 ? "" : sentence(next, 6, long ? 70 : 24),
    points,
    stats: Array.from({ length: 2 + Math.floor(next() * 3) }, () => ({ value: next() < 0.5 ? `${Math.round(next() * 100)}%` : `${(next() * 900).toFixed(1)} mln so‘m`, label: sentence(next, 2, long ? 30 : 8) })),
    quote: { text: sentence(next, 8, long ? 70 : 24), author: sentence(next, 1, 4) },
    chart: next() < 0.5
      ? { labels: ["A", "Ikkinchi guruh", "Uchinchi yo‘nalish", "D"], values: [24, 54, 8, 14], unit: "%", insight: sentence(next, 6, long ? 50 : 18) }
      : { labels: Array.from({ length: 3 + Math.floor(next() * 4) }, () => sentence(next, 1, 3)), values: Array.from({ length: 6 }, () => Math.round(next() * 1000)), unit: "mln", insight: sentence(next, 6, 20) },
    left: { heading: sentence(next, 1, long ? 8 : 3), points: [sentence(next, 2, long ? 30 : 8), sentence(next, 2, 8), sentence(next, 2, long ? 40 : 8)] },
    right: { heading: sentence(next, 1, 3), points: [sentence(next, 2, 8), sentence(next, 2, long ? 30 : 8)] },
    kind,
  };
}

const allFaces = new Set(candidateFaces().flatMap((entry) => entry.weights.map((weight) => `${entry.family}|${weight}`)));
const available = (family, weight) => allFaces.has(`${family}|${weight}`);
const face = (pick) => ({ fontFamily: `jx_${pick.family.toLowerCase().replace(/[^a-z0-9]/g, "")}_${pick.weight}`, fontWeight: String(pick.weight) });

function hostileDecks(style) {
  const failures = [];
  for (let seed = 1; seed <= 160; seed += 1) {
    const next = stream(seed);
    const direction = readArtDirection({
      mode: next() < 0.5 ? "dark" : "light",
      hue: Math.floor(next() * 360),
      mood: MOODS[Math.floor(next() * MOODS.length)],
      typography: ["serif", "sans", "mixed"][Math.floor(next() * 3)],
      energy: next() < 0.5 ? "calm" : "vivid",
    }, `topic ${seed}`);
    const dna = buildDNA({ direction, seed: seed * 31, available, style });
    const count = 1 + Math.floor(next() * 12);
    const outline = readOutline({
      shortTitle: sentence(next, 1, 6),
      subtitle: sentence(next, 4, 30),
      coverQuery: "x",
      slides: Array.from({ length: count }, (_, index) => ({ title: sentence(next, 3, 12), kind: SLIDE_KINDS[(seed + index) % SLIDE_KINDS.length], focus: "f", imageQuery: index % 3 === 0 ? `q${index}` : null })),
    }, { topic: "t", count });
    const slides = outline.slides.map((entry) => readSlide(hostileSlide(next, entry.kind), entry));
    const pictures = new Map(outline.slides.filter((entry) => entry.imageQuery).map((entry) => [entry.imageQuery, { url: "https://example.test/p.jpg" }]));
    const deck = composeDeck({
      dna, face, topic: sentence(next, 3, next() < 0.3 ? 40 : 12), shortTitle: outline.shortTitle, subtitle: outline.subtitle,
      author: next() < 0.7 ? sentence(next, 2, 6) : null, teacher: next() < 0.5 ? sentence(next, 2, 4) : null, year: 2026,
      slides, sources: Array.from({ length: Math.floor(next() * 14) }, () => sentence(next, 4, 30)),
      cover: next() < 0.6 ? { url: "https://example.test/c.jpg" } : null, pictures,
    });
    assert.equal(deck.length, count + 4);
    for (const [index, page] of deck.entries()) {
      const faults = pageFaults(page.rows);
      if (faults.length) failures.push(`seed ${seed} page ${index + 1} (${page.layout}): ${faults.slice(0, 3).join(", ")}`);
      for (const row of page.rows) {
        assert.ok(Number.isFinite(row.x) && Number.isFinite(row.y) && row.width > 0 && row.height > 0, `geometry seed ${seed}`);
        assert.ok(row.x >= -2000 && row.x <= 3000 && row.y >= -2000 && row.y <= 3000, "the database's geometry check");
        if (row.type === "text") assert.ok(String(row.content.text).trim().length > 0, "no empty text rows");
      }
      // An icon carries its own outline, and never lies over a word.
      const words = page.rows.filter((row) => row.type === "text");
      for (const row of page.rows.filter((one) => one.type === "icon")) {
        assert.ok(row.content.vector?.paths?.length > 0, `seed ${seed}: an icon without an outline`);
        if (words.some((word) => touches(row, word, -1))) failures.push(`seed ${seed} page ${index + 1} (${page.layout}): icon ${row.content.glyph} over a word`);
      }
    }
  }
  assert.deepEqual(failures.slice(0, 12), [], `${style}: ${failures.length} faulty pages`);
}

test("hundreds of hostile decks: no page has words on words, off the slide, out of a card or over a picture", () => hostileDecks("glass"));

test("the same, set in the editorial style", () => hostileDecks("editorial"));

test("the same, set in the soft 3D style", () => hostileDecks("soft3d"));

test("the same, set in the corporate style", () => hostileDecks("corporate"));

test("the same, set in the national-ornament style", () => hostileDecks("naqsh"));

test("the same, set in the Spektr infographic style", () => hostileDecks("spektr"));

test("the same, set in the Mozaika geometric style", () => hostileDecks("mozaika"));

test("neighbouring pages never share a composition, and a ten-slide deck uses many", () => {
  const outline = readOutline({ slides: Array.from({ length: 6 }, () => ({ title: "x", kind: "cards", focus: "f", imageQuery: null })) }, { topic: "t", count: 6 });
  const kinds = outline.slides.map((slide) => slide.kind);
  for (let index = 1; index < kinds.length; index += 1) assert.notEqual(kinds[index], kinds[index - 1]);
  assert.ok(new Set(kinds).size >= 3, kinds.join(","));
  assert.ok(varyKinds([{ title: "a", kind: "stats", focus: "", imageQuery: null }, { title: "b", kind: "stats", focus: "", imageQuery: null }])[1].kind !== "stats");
});

test("every palette clears contrast: ink on the ground and on a card", () => {
  for (let hue = 0; hue < 360; hue += 15) {
    for (const mode of ["dark", "light"]) {
      for (const mood of MOODS) {
        const dna = buildDNA({ direction: { mode, hue, mood, typography: "mixed", energy: "vivid" }, seed: hue * 7 + mood.length, available });
        assert.ok(contrast(dna.colors.ink, dna.colors.ground) >= 7, `ink ${mode} ${mood} ${hue}`);
        assert.ok(contrast(dna.colors.inkSoft, dna.colors.ground) >= 4.5, `inkSoft ${mode} ${mood} ${hue}`);
        assert.ok(contrast(dna.colors.accent, dna.colors.ground) >= 4.5, `accent ${mode} ${mood} ${hue}`);
      }
    }
  }
});

test("a design is invented per deck: the same topic with another seed looks different", () => {
  const direction = readArtDirection({ mode: "dark", hue: 260, mood: "cosmic", typography: "serif", energy: "vivid" }, "t");
  const designs = new Set(Array.from({ length: 12 }, (_, seed) => {
    const dna = buildDNA({ direction, seed: seed * 101, available });
    return `${dna.colors.glows.join()}|${dna.fonts.display.family}|${dna.fonts.body.family}|${dna.motif}|${dna.radius}`;
  }));
  assert.ok(designs.size >= 10, `${designs.size} distinct designs of 12`);
});

test("Uzbek apostrophes become the pair every face has", () => {
  assert.equal(normalizeUz("O'zbekiston g`alaba ta'lim maʼnaviyat oʻqituvchi"), "O‘zbekiston g‘alaba ta’lim ma’naviyat o‘qituvchi");
  assert.equal(normalizeUz('"Boburnoma" asari'), "«Boburnoma» asari");
});

test("measuring is exact enough to break lines where the face does", () => {
  const poppins = { family: "Poppins", weight: 400, em: 0.491 };
  // Advance widths from the file: a run of 'n' at 100 is 100 × n's advance.
  const n = textWidth("nnnnnnnnnn", 100, poppins) / 10;
  assert.ok(n > 58 && n < 70, `poppins n advance ${n}`);
  const fitted = fit({ text: "Sun’iy intellektning ta’limdagi o‘rni va istiqbollari", font: poppins, width: 400, height: 200, max: 60, min: 20, leading: 1.1 });
  assert.ok(fitted.lines <= 4 && fitted.size >= 20);
});

test("the colour space is sound", () => {
  assert.equal(oklch(1, 0, 0), "#FFFFFF");
  assert.equal(oklch(0, 0, 0), "#000000");
  assert.equal(W, 1000);
  assert.equal(H, 562.5);
});

test("both schemas the engine sends are ones Gemini accepts", async () => {
  const { toGeminiSchema, geminiSchemaProblems } = await import(`${edge}/gemini-schema.js`);
  const { outlineSchema, contentSchema } = await import(`${edge}/glass/content.js`);
  for (const [name, schema] of [["outline", outlineSchema(6)], ["content", contentSchema()]]) {
    const problems = geminiSchemaProblems(toGeminiSchema(schema));
    assert.deepEqual(problems, [], `${name}: ${JSON.stringify(problems.slice(0, 3))}`);
  }
});

test("the copy schema never asks for a count, which is what Gemini refused", async () => {
  /**
   * The production failure of the first glass decks.
   *
   * `minItems = maxItems = 6` on the array of slides made Gemini refuse every
   * full batch of six with INVALID_ARGUMENT, twice, and those pages were built
   * from the outline as plain statements — decks of text with a designed page
   * or two at the end, where the last, shorter batch had got through. The same
   * refusal is measured for the old engine in gemini-schema.test.mjs.
   */
  const { toGeminiSchema } = await import(`${edge}/gemini-schema.js`);
  const { contentSchema } = await import(`${edge}/glass/content.js`);
  assert.equal(contentSchema.length, 0, "it takes no count, so it cannot be given one");
  const serialised = JSON.stringify(toGeminiSchema(contentSchema()));
  assert.doesNotMatch(serialised, /minItems|maxItems/);
});

test("a refused batch is split until every page that can be written is", async () => {
  const { inBatches } = await import(`${edge}/glass/batches.js`);
  const items = Array.from({ length: 10 }, (_, index) => ({ index }));
  const answer = (batch) => new Map(batch.map((item) => [item.index, `page ${item.index}`]));

  // Refuses anything larger than two, as Gemini refused six.
  const failures = [];
  const small = await inBatches({
    items, size: 4,
    ask: async (batch) => { if (batch.length > 2) throw new Error("INVALID_ARGUMENT"); return answer(batch); },
    failed: (batch, _attempts, reason) => failures.push([batch.length, reason]),
  });
  assert.equal(small.size, 10, "every page written after the split");
  assert.deepEqual(failures.map(([size]) => size), [4, 4], "only the two full batches failed");
  assert.equal(failures[0][1], "INVALID_ARGUMENT", "and the reason is kept");

  // One page that always fails costs that page and nothing else.
  const poisoned = await inBatches({
    items, size: 4,
    ask: async (batch) => { if (batch.some((item) => item.index === 5)) throw new Error("bad"); return answer(batch); },
  });
  assert.deepEqual([...poisoned.keys()].sort((a, b) => a - b), [0, 1, 2, 3, 4, 6, 7, 8, 9]);

  // A short answer is asked again for what it left out; an empty one is split.
  const asked = [];
  const partial = await inBatches({
    items: items.slice(0, 4), size: 4,
    ask: async (batch) => {
      asked.push(batch.map((item) => item.index).join(","));
      if (asked.length === 1) return answer(batch.slice(0, 2));
      if (asked.length === 2) return new Map();
      return answer(batch);
    },
  });
  assert.equal(partial.size, 4);
  assert.deepEqual(asked.slice(0, 2), ["0,1,2,3", "2,3"]);
});

test("a model answer of any shape still becomes a usable slide", async () => {
  const { readSlide, readOutline } = await import(`${edge}/glass/content.js`);
  const outline = readOutline("garbage", { topic: "Mavzu", count: 4 });
  assert.equal(outline.slides.length, 4);
  for (const answer of [null, 42, "text", {}, { kind: "stats", stats: [{ value: "yo‘q", label: "x" }] }, { chart: { labels: ["a"], values: ["x"] } }]) {
    for (const entry of outline.slides) {
      const slide = readSlide(answer, entry);
      assert.ok(slide.title.length > 0);
      if (slide.kind === "stats") assert.ok(slide.stats.length >= 2);
      if (slide.kind === "chart") assert.ok(slide.chart);
      if (slide.kind === "statement") assert.ok(slide.lead.length > 0);
    }
  }
});

test("a deck researched without live links still closes on a real bibliography", async () => {
  const { sourcesFromNotes } = await import(`${edge}/glass/content.js`);
  const notes = [
    "**FAKTLAR:**",
    "- AI vositalaridan foydalanish 2024-yilda 62% ga yetdi (UNESCO, 2024).",
    "- Ta’lim bozori $6,1 mlrd (HolonIQ, 2024).",
    "**TA’RIFLAR:**",
    "- Sun’iy intellekt — inson tafakkuriga xos vazifalarni bajaruvchi tizim.",
    "**MANBALAR:**",
    "1. [UNESCO: AI and the Future of Education](https://www.unesco.org/en/digital-education/artificial-intelligence)",
    "2. OECD Digital Education Outlook 2023 — https://www.oecd.org/education/",
    "- *HolonIQ, Education AI market, 2024*",
  ].join("\n");
  assert.deepEqual(sourcesFromNotes(notes), [
    "UNESCO: AI and the Future of Education — unesco.org",
    "OECD Digital Education Outlook 2023 — oecd.org",
    "HolonIQ, Education AI market, 2024",
  ]);

  // Inline after the heading, separated by semicolons.
  assert.deepEqual(sourcesFromNotes("MANBALAR: Jahon banki, 2023; O‘zstat, 2024"), ["Jahon banki, 2023", "O‘zstat, 2024"]);

  // No list at all: the "(manba)" every fact was asked to end with.
  assert.deepEqual(sourcesFromNotes("- 62% (UNESCO, 2024)\n- 3 800 talaba (2024)\n- bozor (HolonIQ hisobot)"), ["UNESCO, 2024", "HolonIQ hisobot"]);
  assert.deepEqual(sourcesFromNotes(""), []);

  // A list of bare links keeps the address, not just the site.
  assert.deepEqual(sourcesFromNotes("MANBALAR:\n- https://president.uz/uz/lists/view/5678\n- https://www.gov.uz/"), ["president.uz/uz/lists/view/5678", "gov.uz"]);
});

test("every face the engine can choose has measured widths", async () => {
  /**
   * A face without metrics is measured with Manrope's widths. Montserrat
   * Alternates was one: wider than Manrope, so a timeline label "fitted" on one
   * line and drew on two, across the axis under it.
   */
  const { candidateFaces } = await import(`${edge}/glass/dna.js`);
  const { METRICS } = await import(`${edge}/glass/metrics.js`);
  const missing = candidateFaces().flatMap((entry) => entry.weights.map((weight) => `${entry.family}|${weight}`)).filter((key) => !METRICS[key]);
  assert.deepEqual(missing, []);
});

test("a chart speaks Uzbek numbers and names its bars in full beside them", async () => {
  const { uzNumber } = await import(`${edge}/glass/compose.js`);
  assert.equal(uzNumber(2.55), "2,55");
  assert.equal(uzNumber(14806), "14806");
  assert.equal(uzNumber(1.234), "1,23");

  const { readSlide, readOutline } = await import(`${edge}/glass/content.js`);
  const [entry] = readOutline({ slides: [{ title: "Quvvatlar", kind: "chart", focus: "f", imageQuery: null }] }, { topic: "t", count: 1 }).slides;
  const slide = readSlide({ title: "Quvvatlar", chart: { labels: ["Issiqlik elektr stansiyalari", "Gidroelektr stansiyalari", "Quyosh va shamol stansiyalari"], values: [14806, 2225.6, 1290], unit: "MVt", insight: "x" } }, entry);
  assert.ok(slide.chart.labels.every((label) => label.length <= 22), "a bar keeps a short label");
  assert.deepEqual(slide.chart.names, ["Issiqlik elektr stansiyalari", "Gidroelektr stansiyalari", "Quyosh va shamol stansiyalari"]);

  // Two values are two numbers, not a chart.
  const pair = readSlide({ title: "Hudud", chart: { labels: ["Min", "Maks"], values: [7, 8], unit: "mln km²", insight: "x" } }, entry);
  assert.notEqual(pair.kind, "chart");
});

test("a remembered address that does not open is cut back to its site", async () => {
  const { checkSources } = await import(`${edge}/glass/sources.js`);
  const opened = [];
  const fake = async (url) => {
    opened.push(url);
    if (url.includes("Amir_Temur")) return new Response("ok", { status: 200 });
    if (url.includes("slow")) return new Promise(() => {});
    return new Response("missing", { status: 404 });
  };
  const result = await checkSources([
    "uz.wikipedia.org/wiki/Amir_Temur",
    "https://uz.wikipedia.org/wiki/AmirTemur",
    "www.gov.uz/",
    "slow.example.uz/page",
    "Ibragimov A. Temuriylar davri. Toshkent, 2019",
  ], fake, 50);
  assert.deepEqual(result, [
    "uz.wikipedia.org/wiki/Amir_Temur",
    "uz.wikipedia.org",
    "gov.uz",
    "slow.example.uz",
    "Ibragimov A. Temuriylar davri. Toshkent, 2019",
  ]);
  assert.ok(!opened.some((url) => url.includes("gov.uz")), "a bare site is not opened");
  assert.ok(opened.every((url) => url.startsWith("https://")));
});

test("a search citation is shown as the page it leads to, never as Google's redirect", async () => {
  const { resolveCitations, checkSources, address } = await import(`${edge}/glass/sources.js`);
  const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123";
  const landed = (url) => async () => ({ ok: true, status: 200, url, body: null });
  const [resolved] = await resolveCitations([{ title: "unesco.org", url: redirect }], landed("https://www.unesco.org/en/digital-education/"));
  assert.deepEqual(resolved, { title: "unesco.org/en/digital-education", url: "https://www.unesco.org/en/digital-education/" });

  // When the redirect cannot be followed, the site's own name is still true.
  const [kept] = await resolveCitations([{ title: "unesco.org", url: redirect }], async () => { throw new Error("offline"); });
  assert.deepEqual(kept, { title: "unesco.org", url: redirect });

  // A redirect copied into the notes either becomes its page or disappears.
  assert.deepEqual(await checkSources([redirect.replace("https://", "")], landed("https://stat.uz/uz/rasmiy-statistika")), ["stat.uz/uz/rasmiy-statistika"]);
  assert.deepEqual(await checkSources([redirect.replace("https://", "")], async () => ({ ok: false, status: 404, url: "", body: null })), []);
  assert.equal(address("https://www.gov.uz/uz/news/"), "gov.uz/uz/news");
});

test("a bibliography lists pages a student can cite — not a captcha, a social post or a file share", async () => {
  const { citable, resolveCitations, checkSources } = await import(`${edge}/glass/sources.js`);
  for (const ok of ["uz.wikipedia.org/wiki/Amir_Temur", "stat.uz/uz/rasmiy-statistika", "Ibragimov A. Temuriylar davri. Toshkent, 2019"]) assert.ok(citable(ok), ok);
  for (const bad of ["google.com/sorry/index", "ok.ru/group/549/topic/1", "scribd.com/presentation/7016", "www.youtube.com/watch?v=1", "t.me/kanal/5", "vertexaisearch.cloud.google.com/grounding-api-redirect/x"]) assert.ok(!citable(bad), bad);

  const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123";
  const captcha = async () => ({ ok: true, status: 200, url: "https://www.google.com/sorry/index?continue=x", body: null });
  // Stopped by Google: the citation keeps the site's own name rather than the check page.
  assert.deepEqual(await resolveCitations([{ title: "unesco.org", url: redirect }], captcha), [{ title: "unesco.org", url: redirect }]);
  // And a redirect copied into the notes that lands there names nothing at all.
  assert.deepEqual(await checkSources([redirect], captcha), []);
});

test("a word wider than its line is broken where a reader would, and an address is shortened", async () => {
  const { breakLong, textWidth, setAt, wrap } = await import(`${edge}/glass/text.js`);
  const { address } = await import(`${edge}/glass/sources.js`);
  const font = { family: "Manrope", weight: 400, em: 0.5 };
  const url = "documents1.worldbank.org/curated/en/099734306182493324/pdf/IDU15b741a2860c";
  const broken = breakLong(url, 12, font, 150);
  for (const line of broken.split("\n")) assert.ok(textWidth(line, 12, font) <= 150 + 0.5, line);
  assert.equal(broken.replace(/\n/g, ""), url, "nothing is lost, only broken");
  assert.ok(/[/.\-_]$/.test(broken.split("\n")[0]), "an address breaks after a slash or a dot, not mid-word");

  // setAt draws exactly what it measured — no line wider than the box — and
  // says it had to split a word, so a caller that can go smaller does.
  const set = setAt({ text: `Manba: ${url}`, font, width: 150, size: 12, leading: 1.3 });
  assert.equal(set.cut, true);
  for (const line of wrap(set.text, 12, font, 150)) assert.ok(textWidth(line, 12, font) <= 150 + 0.5, line);

  assert.equal(address("https://documents1.worldbank.org/curated/en/099734306182493324/pdf/IDU15b741a2860c.pdf"), "documents1.worldbank.org/curated/en/…");
  assert.equal(address("https://www.unesco.org/en/digital-education/"), "unesco.org/en/digital-education");
  assert.ok(address("https://a.uz/" + "x".repeat(200)).length <= 60);
});

test("every editorial palette clears contrast: ink on paper and on a card, and on the colour field", () => {
  for (let hue = 0; hue < 360; hue += 15) {
    for (const mode of ["dark", "light"]) {
      for (const mood of MOODS) {
        for (const energy of ["calm", "vivid"]) {
          const dna = buildDNA({ direction: { mode, hue, mood, typography: "mixed", energy }, seed: hue * 13 + mood.length, available, style: "editorial" });
          const where = `${mode} ${mood} ${energy} ${hue}`;
          assert.equal(dna.style, "editorial");
          assert.ok(contrast(dna.colors.ink, dna.colors.ground) >= 7, `ink ${where}`);
          assert.ok(contrast(dna.colors.ink, dna.colors.panelStrong) >= 7, `ink on panel ${where}`);
          assert.ok(contrast(dna.colors.inkSoft, dna.colors.panel) >= 4.5, `inkSoft on card ${where}`);
          assert.ok(contrast(dna.colors.accent, dna.colors.ground) >= 4.5, `accent ${where}`);
          assert.ok(contrast(dna.colors.onBlock, dna.colors.block) >= 4.5, `on the field ${where}: ${contrast(dna.colors.onBlock, dna.colors.block).toFixed(2)}`);
        }
      }
    }
  }
});

test("an editorial page's printed marks never touch a word or a picture", async () => {
  const { paperBackdrop } = await import(`${edge}/glass/paper.js`);
  const { intersects } = await import(`${edge}/glass/backdrop.js`);
  for (let seed = 1; seed <= 200; seed += 1) {
    const next = stream(seed);
    const keep = Array.from({ length: 1 + Math.floor(next() * 6) }, () => {
      const width = 60 + next() * 500;
      const height = 30 + next() * 300;
      return { x: 40 + next() * (W - 80 - width), y: 30 + next() * (H - 60 - height), width, height };
    });
    const dna = buildDNA({ direction: { mode: next() < 0.5 ? "dark" : "light", hue: Math.floor(next() * 360), mood: MOODS[seed % MOODS.length], typography: "sans", energy: "vivid" }, seed, available, style: "editorial" });
    const marks = paperBackdrop({ dna, next, light: ["left", "right", "top", "bottom", "center", "corners"][seed % 6], keep, hero: seed % 5 === 0 });
    for (const mark of marks) {
      assert.ok(mark.locked && mark.content.decor, "a mark is decoration, locked");
      for (const rect of keep) assert.ok(!intersects(mark, rect, 0), `seed ${seed}: a ${mark.style.shape ?? "block"} touches content`);
    }
  }
});

test("a figure keeps its unit: shortened the Uzbek way, never cut to a dot-dot-dot", async () => {
  const { compactValue } = await import(`${edge}/glass/content.js`);
  assert.equal(compactValue("209,2 milliard so‘m"), "209,2 mlrd so‘m");
  assert.equal(compactValue("2.55 foiz"), "2,55%");
  assert.equal(compactValue("300 megavatt"), "300 MVt");
  assert.equal(compactValue("1991"), "1991");
});

test("every soft 3D palette clears contrast: ink on the studio and on both ends of a card", () => {
  for (let hue = 0; hue < 360; hue += 15) {
    for (const mode of ["dark", "light"]) {
      for (const mood of MOODS) {
        const dna = buildDNA({ direction: { mode, hue, mood, typography: "serif", energy: "vivid" }, seed: hue * 17 + mood.length, available, style: "soft3d" });
        const where = `${mode} ${mood} ${hue}`;
        assert.equal(dna.style, "soft3d");
        for (const ground of [dna.colors.ground, dna.colors.ground2, dna.colors.panel, dna.colors.panelStrong]) {
          assert.ok(contrast(dna.colors.ink, ground) >= 7, `ink ${where}`);
          assert.ok(contrast(dna.colors.inkSoft, ground) >= 4.5, `inkSoft ${where}`);
        }
        assert.ok(contrast(dna.colors.accent, dna.colors.panel) >= 4.5, `accent on a card ${where}`);
        assert.ok(!/serif/i.test(dna.fonts.display.family) || /sans/i.test(dna.fonts.display.family), `a sans display ${where}: ${dna.fonts.display.family}`);
      }
    }
  }
});

test("a soft 3D page's controls — and their shadows — never touch a word or a picture", async () => {
  const { studioBackdrop } = await import(`${edge}/glass/studio.js`);
  const { intersects } = await import(`${edge}/glass/backdrop.js`);
  let placed = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const next = stream(seed);
    const keep = Array.from({ length: 1 + Math.floor(next() * 5) }, () => {
      const width = 60 + next() * 460;
      const height = 30 + next() * 280;
      return { x: 40 + next() * (W - 80 - width), y: 30 + next() * (H - 60 - height), width, height };
    });
    const dna = buildDNA({ direction: { mode: next() < 0.5 ? "dark" : "light", hue: Math.floor(next() * 360), mood: MOODS[seed % MOODS.length], typography: "sans", energy: "vivid" }, seed, available, style: "soft3d" });
    const rows = studioBackdrop({ dna, next, light: ["left", "right", "top", "bottom", "center", "corners"][seed % 6], keep, hero: seed % 5 === 0 });
    placed += rows.length ? 1 : 0;
    for (const row of rows) {
      assert.ok(row.locked && row.content.decor, "a control is decoration, locked");
      assert.ok(row.x >= -1 && row.y >= -1 && row.x + row.width <= W + 1 && row.y + row.height <= H + 1, `seed ${seed}: a control leaves the page`);
      for (const rect of keep) assert.ok(!intersects(row, rect, 0), `seed ${seed}: a ${row.content.kind} touches content`);
    }
  }
  assert.ok(placed > 120, `controls appear on most pages (${placed}/200)`);
});

test("a design choice from the create screen is kept only when it names a real style and family", async () => {
  const { readDesignRequest, PALETTES, STYLES } = await import(`${edge}/glass/dna.js`);
  assert.deepEqual([...STYLES], ["glass", "editorial", "soft3d", "corporate", "naqsh", "spektr", "mozaika"]);
  assert.deepEqual(readDesignRequest({ style: "editorial", palette: "teal" }), { style: "editorial", palette: "teal" });
  assert.deepEqual(readDesignRequest({ style: "soft3d" }), { style: "soft3d", palette: null });
  assert.deepEqual(readDesignRequest({ style: "glass", palette: "plaid" }), { style: "glass", palette: null });
  for (const bad of [null, undefined, "editorial", { style: "jslayd" }, { palette: "blue" }, []]) assert.equal(readDesignRequest(bad), null);
  for (const hue of Object.values(PALETTES)) assert.ok(hue >= 0 && hue < 360);
  // The families the database accepts are exactly these.
  // The newest migration that sets the column's constraint is the one in force.
  const fs = await import("node:fs");
  const dir = new URL("../migrations/", import.meta.url);
  const latest = fs.readdirSync(dir).filter((name) => fs.readFileSync(new URL(name, dir), "utf8").includes("presentations_design_request_shape check")).sort().pop();
  const migration = fs.readFileSync(new URL(latest, dir), "utf8");
  for (const family of Object.keys(PALETTES)) assert.match(migration, new RegExp(`'${family}'`));
  for (const style of STYLES) assert.match(migration, new RegExp(`'${style}'`));
});

test("a long word is set smaller before it is ever split", async () => {
  const { fitGroup } = await import(`${edge}/glass/text.js`);
  const font = { family: "Manrope", weight: 700, em: 0.52 };
  // Fits whole at a smaller size: the group shrinks rather than breaking it.
  const group = fitGroup([[{ text: "Kosmik texnologiyalarning zamonaviy o‘rni", font, size: 60, min: 26, leading: 1.04, maxLines: 5 }]], 330, 400);
  assert.ok(!group.pieces[0][0].text.includes("\n"), group.pieces[0][0].text);
  assert.ok(group.scale < 1, "it was set smaller instead");
});

test("every corporate palette clears contrast: ink on white, white on the brand", () => {
  for (let hue = 0; hue < 360; hue += 10) {
    for (const mood of MOODS) {
      for (const energy of ["calm", "vivid"]) {
        const dna = buildDNA({ direction: { mode: "dark", hue, mood, typography: "serif", energy }, seed: hue * 7 + mood.length, available, style: "corporate" });
        const where = `${mood} ${energy} ${hue}`;
        assert.equal(dna.direction.mode, "light", "always on white");
        assert.ok(contrast(dna.colors.ink, "#FFFFFF") >= 8, `ink ${where}`);
        assert.ok(contrast(dna.colors.inkSoft, dna.colors.panelStrong) >= 4.5, `inkSoft ${where}`);
        assert.ok(contrast(dna.colors.accent, "#FFFFFF") >= 4.5, `brand on white ${where}`);
        assert.ok(contrast("#FFFFFF", dna.colors.glows[0]) >= 4.5 && contrast("#FFFFFF", dna.colors.glows[1]) >= 4.5, `white on the brand ${where}`);
      }
    }
  }
});

test("a corporate page's brand forms never touch a word set on the white", async () => {
  const { corporateBackdrop } = await import(`${edge}/glass/corporate.js`);
  const { intersects } = await import(`${edge}/glass/backdrop.js`);
  let forms = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const next = stream(seed);
    const words = Array.from({ length: 1 + Math.floor(next() * 4) }, () => {
      const width = 80 + next() * 420;
      const height = 14 + next() * 120;
      return { x: 60 + next() * (W - 120 - width), y: 40 + next() * (H - 80 - height), width, height };
    });
    const dna = buildDNA({ direction: { mode: "light", hue: Math.floor(next() * 360), mood: MOODS[seed % MOODS.length], typography: "sans", energy: "vivid" }, seed, available, style: "corporate" });
    const rows = corporateBackdrop({ dna, next, light: ["left", "right", "top", "bottom", "center", "corners"][seed % 6], words, keep: words, hero: false });
    for (const row of rows) {
      assert.ok(row.locked && row.content.decor, "decoration, locked");
      for (const word of words) assert.ok(!intersects(row, word, 0), `seed ${seed}: a ${row.content.kind} touches a word`);
    }
    forms += rows.some((row) => row.content.kind === "brand") ? 1 : 0;
  }
  assert.ok(forms > 140, `most pages carry a brand form (${forms}/200)`);
});

test("an icon is chosen by what the words say, and a page does not repeat one", () => {
  assert.ok(ICON_NAMES.length >= 120, `the set is loaded (${ICON_NAMES.length})`);
  for (const name of ICON_NAMES) {
    for (const weight of ["fill", "duo"]) {
      const vector = iconVector(name, weight);
      assert.equal(vector.box, 256);
      assert.ok(vector.paths.length > 0 && vector.paths.every((path) => /^M/.test(path.d)), `${name} ${weight} has outlines`);
    }
  }
  // Endings and every spelling of the apostrophe still find the subject.
  assert.equal(pickIcon("Ta’lim tizimidagi islohotlar"), "graduation-cap");
  assert.equal(pickIcon("Kimyoviy reaksiyalar tezligi"), "flask");
  assert.equal(pickIcon("Qayta tiklanuvchi energiya manbalari"), "lightning");
  assert.equal(pickIcon("Sun'iy intellekt va robototexnika"), "robot");
  assert.equal(pickIcon("Yurak-qon tomir sog‘lig‘i"), "heart");
  // A two-letter keyword must be a whole word: "kitob" is not "it".
  assert.notEqual(pickIcon("Kitobxonlik madaniyati"), "cpu");
  // What is already on the page is skipped, and words that name nothing still get an icon.
  assert.notEqual(pickIcon("Ta’lim sifati", new Set(["graduation-cap"])), "graduation-cap");
  assert.ok(ICON_NAMES.includes(pickIcon("zzzz qwerty")));
});

test("every naqsh family clears contrast, and its ornaments are the colours the page is", async () => {
  const { NAQSH_FAMILIES, NAQSH_FAMILY_KEYS, nearestFamily, hex } = await import(`${edge}/glass/naqsh-palette.js`);
  const { PALETTES } = await import(`${edge}/glass/dna.js`);
  assert.deepEqual([...NAQSH_FAMILY_KEYS].sort(), Object.keys(PALETTES).sort(), "one ornament family per palette family");
  for (const [family, hue] of Object.entries(PALETTES)) {
    assert.equal(nearestFamily(hue), family, `${family} picks its own ornaments`);
    const dna = buildDNA({ direction: { mode: "dark", hue, mood: "warm", typography: "mixed", energy: "vivid" }, seed: 7, available, style: "naqsh" });
    assert.equal(dna.direction.mode, "light", "a naqsh page is always light");
    assert.equal(dna.ornament, family);
    // The page's colours are the ones the pictures were baked in.
    assert.equal(dna.colors.accent, hex(NAQSH_FAMILIES[family].deep));
    assert.equal(dna.colors.accent2, hex(NAQSH_FAMILIES[family].bright));
    assert.ok(contrast(dna.colors.onAccent, dna.colors.accent) >= 4.5, `${family}: white on the deep ink`);
    assert.ok(contrast(dna.colors.onAccent, dna.colors.accent2) >= 3, `${family}: white on the bright ink, at badge size`);
    assert.ok(contrast(dna.colors.ink, dna.colors.ground) >= 7, `${family}: ink on the page`);
    assert.ok(contrast(dna.colors.inkSoft, dna.colors.ground) >= 4.5, `${family}: soft ink on the page`);
  }
});

test("a naqsh band never touches a word on the page, and every ornament shows at its own proportions", async () => {
  const { naqshBackdrop } = await import(`${edge}/glass/naqsh.js`);
  const { NAQSH_ASSETS } = await import(`${edge}/glass/naqsh-palette.js`);
  let bands = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const next = stream(seed);
    const words = Array.from({ length: 1 + Math.floor(next() * 4) }, () => {
      const width = 80 + next() * 760;
      const height = 14 + next() * 120;
      return { x: 64 + next() * (W - 128 - width), y: 40 + next() * (H - 80 - height), width, height };
    });
    const dna = buildDNA({ direction: { mode: "light", hue: Math.floor(next() * 360), mood: MOODS[seed % MOODS.length], typography: "mixed", energy: "vivid" }, seed, available, style: "naqsh" });
    const rows = naqshBackdrop({ dna, family: dna.ornament, next, light: "right", words, keep: words, hero: false });
    for (const row of rows) {
      assert.ok(row.locked && row.content.decor, "decoration, locked");
      if (row.type === "image" && row.content.ornament !== "paper") {
        const size = NAQSH_ASSETS[row.content.ornament];
        assert.ok(size, `a known ornament (${row.content.ornament})`);
        assert.ok(Math.abs(row.width - size.width) < 0.6 && Math.abs(row.height - size.height) < 0.6, "drawn at the picture's own proportions");
        const shown = { x: Math.max(0, row.x), y: 0, width: Math.min(W, row.x + row.width) - Math.max(0, row.x), height: H };
        for (const word of words) assert.ok(!touches(shown, word, 0), `seed ${seed}: the band touches a word`);
        bands += 1;
      }
    }
  }
  assert.ok(bands > 100, `most pages carry a band (${bands}/200)`);
});

test("every Spektr family clears contrast: white on the hero's deep side, each spectrum colour both ways on white", async () => {
  const { SPEKTR_FAMILIES } = await import(`${edge}/glass/spektr.js`);
  const { PALETTES } = await import(`${edge}/glass/dna.js`);
  assert.deepEqual(Object.keys(SPEKTR_FAMILIES).sort(), Object.keys(PALETTES).sort(), "one Spektr family per palette family");
  for (const [family, hue] of Object.entries(PALETTES)) {
    const { hero, spectrum } = SPEKTR_FAMILIES[family];
    // The words of a hero page sit over its first two stops; only the icon over the last.
    assert.ok(contrast("#FFFFFF", hero[0]) >= 4.5 && contrast("#FFFFFF", hero[1]) >= 4.5, `${family}: white over the words' side of the hero`);
    assert.ok(contrast("#FFFFFF", hero[2]) >= 3, `${family}: white over the hero's bright end`);
    // A figure in its colour on white, and a white number in a disc of it.
    for (const color of spectrum) assert.ok(contrast("#FFFFFF", color) >= 4.5, `${family}: ${color} against white`);
    assert.equal(new Set(spectrum).size, spectrum.length, `${family}: five different colours`);
    const dna = buildDNA({ direction: { mode: "dark", hue, mood: "warm", typography: "serif", energy: "calm" }, seed: 11, available, style: "spektr" });
    assert.equal(dna.direction.mode, "light", "a Spektr page is always white");
    assert.deepEqual([...dna.colors.chart], spectrum, `${family}: the page's spectrum is the family's`);
    assert.ok(contrast(dna.colors.ink, dna.colors.ground) >= 7, `${family}: ink on the page`);
    assert.ok(contrast(dna.colors.inkSoft, dna.colors.ground) >= 4.5, `${family}: soft ink on the page`);
    assert.ok(contrast(dna.colors.accent, dna.colors.ground) >= 4.5, `${family}: the accent as small type on white`);
  }
});

test("a Spektr hero page: the gradient under everything, white words, the giant icon clear of them; content pages white and coloured", () => {
  let icons = 0;
  let heroes = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const next = stream(seed * 13);
    const dna = buildDNA({ direction: { mode: "light", hue: Math.floor(next() * 360), mood: MOODS[seed % MOODS.length], typography: "sans", energy: "vivid" }, seed, available, style: "spektr" });
    const kinds = ["statement", "stats", "cards", "quote", "bullets"];
    const outline = readOutline({ shortTitle: "Qisqa", subtitle: sentence(next, 4, 14), coverQuery: "x",
      slides: kinds.map((kind) => ({ title: sentence(next, 3, 8), kind, focus: "f", imageQuery: null })) }, { topic: "t", count: kinds.length });
    const slides = outline.slides.map((entry) => readSlide(hostileSlide(next, entry.kind), entry));
    const deck = composeDeck({ dna, face, topic: "Sun’iy intellekt ta’limda", shortTitle: "Qisqa", subtitle: outline.subtitle,
      author: "Ali Valiyev", teacher: seed % 2 ? "N. Karimova" : null, year: 2026, slides, sources: [], cover: { url: "https://example.test/c.jpg" }, pictures: new Map() });
    for (const page of deck) {
      const field = page.rows.find((row) => row.content.kind === "field");
      const hero = ["cover", "closing"].includes(page.layout) || Boolean(field);
      if (["cover", "closing"].includes(page.layout)) assert.ok(field, `seed ${seed}: ${page.layout} is a hero page`);
      if (!hero) {
        assert.equal(page.background.color, "#FFFFFF");
        assert.ok(page.rows.some((row) => row.content.kind === "spectrum"), "a white page carries the spectrum line");
        continue;
      }
      heroes += 1;
      assert.equal(page.rows[0], field, "the gradient lies under everything");
      const panels = page.rows.filter((row) => row.type === "shape" && row.content.kind === "panel");
      const within = (one, box) => one.x >= box.x - 1 && one.y >= box.y - 1 && one.x + one.width <= box.x + box.width + 1 && one.y + one.height <= box.y + box.height + 1;
      for (const word of page.rows.filter((row) => row.type === "text" && !panels.some((panel) => within(row, panel)))) {
        assert.match(String(word.style.color), /^#FFFFFF/i, `seed ${seed} ${page.layout}: ${word.content.role} is white on the gradient`);
        assert.ok(word.x + word.width <= 64 + 486 + 1, `seed ${seed} ${page.layout}: ${word.content.role} stays in the column`);
      }
      const mark = page.rows.find((row) => row.content.kind === "hero-icon");
      if (mark) {
        icons += 1;
        assert.ok(mark.content.vector.paths.length > 0);
        for (const word of page.rows.filter((row) => row.type === "text")) assert.ok(!touches(mark, word, 20), `seed ${seed}: the hero icon touches a word`);
      }
    }
  }
  assert.ok(icons >= heroes * 0.9, `nearly every hero page carries its icon (${icons}/${heroes})`);
});

test("every Mozaika family clears contrast: white on its field, its figures on white", async () => {
  const { MOZAIKA_FAMILIES } = await import(`${edge}/glass/mozaika.js`);
  const { PALETTES } = await import(`${edge}/glass/dna.js`);
  assert.deepEqual(Object.keys(MOZAIKA_FAMILIES).sort(), Object.keys(PALETTES).sort(), "one Mozaika family per palette family");
  for (const [family, hue] of Object.entries(PALETTES)) {
    const { hero, lead, spectrum, heroTiles } = MOZAIKA_FAMILIES[family];
    assert.ok(contrast("#FFFFFF", hero) >= 4.5, `${family}: white words on the field`);
    assert.ok(contrast("#FFFFFF", lead) >= 4.5, `${family}: the lead colour as small type on white`);
    for (const color of spectrum) assert.ok(contrast("#FFFFFF", color) >= 4.5, `${family}: ${color} against white`);
    assert.equal(new Set(spectrum).size, spectrum.length, `${family}: five different figure colours`);
    // The mosaic on the field never paints a cell the field's own colour.
    assert.ok(!heroTiles.includes(hero), `${family}: a hero tile vanishes into the field`);
    const dna = buildDNA({ direction: { mode: "dark", hue, mood: "warm", typography: "serif", energy: "calm" }, seed: 5, available, style: "mozaika" });
    assert.equal(dna.direction.mode, "light");
    assert.equal(dna.colors.block, hero);
    assert.deepEqual([...dna.colors.chart], spectrum);
    assert.ok(contrast(dna.colors.ink, dna.colors.ground) >= 7, `${family}: ink on the page`);
    assert.ok(contrast(dna.colors.inkSoft, dna.colors.ground) >= 4.5, `${family}: soft ink on the page`);
  }
});

test("a Mozaika mosaic never touches the words or the content; hero pages are a field with white words", () => {
  let strips = 0;
  let pages = 0;
  let photos = 0;
  for (let seed = 1; seed <= 60; seed += 1) {
    const next = stream(seed * 29);
    const dna = buildDNA({ direction: { mode: "light", hue: Math.floor(next() * 360), mood: MOODS[seed % MOODS.length], typography: "sans", energy: "vivid" }, seed, available, style: "mozaika" });
    const kinds = ["statement", "stats", "cards", "quote", "bullets", "timeline", "process", "comparison", "chart", "photo"];
    const outline = readOutline({ shortTitle: "Qisqa", subtitle: sentence(next, 4, 14), coverQuery: "x",
      slides: kinds.map((kind, index) => ({ title: sentence(next, 3, 10), kind, focus: "f", imageQuery: index === kinds.length - 1 ? "p" : null })) }, { topic: "t", count: kinds.length });
    const slides = outline.slides.map((entry) => readSlide(hostileSlide(next, entry.kind), entry));
    const deck = composeDeck({ dna, face, topic: sentence(next, 3, 10), shortTitle: "Qisqa", subtitle: outline.subtitle,
      author: "Ali Valiyev", teacher: seed % 2 ? "N. Karimova" : null, year: 2026, slides, sources: [sentence(next, 4, 12)],
      cover: seed % 3 ? { url: "https://example.test/c.jpg" } : null, pictures: new Map([["p", { url: "https://example.test/p.jpg" }]]) });
    for (const page of deck) {
      pages += 1;
      const tiles = page.rows.filter((row) => row.content.kind === "tile");
      const words = page.rows.filter((row) => row.type === "text");
      for (const tile of tiles) {
        for (const word of words) assert.ok(!touches(tile, word, 4), `seed ${seed} ${page.layout}: a tile touches ${word.content.role}`);
      }
      const hero = page.background.color !== "#FFFFFF";
      if (["cover", "closing"].includes(page.layout)) assert.ok(hero, `seed ${seed}: ${page.layout} is a field`);
      if (hero) {
        assert.equal(page.background.color, dna.colors.block);
        assert.ok(tiles.length > 10, `seed ${seed} ${page.layout}: a hero page carries its mosaic`);
        const panels = page.rows.filter((row) => row.type === "shape" && row.content.kind === "panel");
        const inside = (one, box) => one.x >= box.x - 1 && one.y >= box.y - 1 && one.x + one.width <= box.x + box.width + 1 && one.y + one.height <= box.y + box.height + 1;
        for (const word of words.filter((row) => !panels.some((panel) => inside(row, panel)))) {
          assert.match(String(word.style.color), /^#FFFFFF/i, `seed ${seed} ${page.layout}: ${word.content.role} is white on the field`);
        }
        if (page.layout === "cover" && seed % 3) {
          assert.ok(page.rows.some((row) => row.type === "image" && row.style.borderRadius >= row.width / 2 - 1), "the cover's photograph is in the mosaic");
          photos += 1;
        }
        continue;
      }
      // On a white page the column of cells clears everything the page holds.
      const content = page.rows.filter((row) => !row.content.decor);
      for (const tile of tiles) for (const one of content) assert.ok(!touches(tile, one, 2), `seed ${seed} ${page.layout}: a tile touches ${one.content.kind ?? one.type}`);
      if (tiles.length) strips += 1;
    }
  }
  assert.ok(strips > pages * 0.4, `most white pages carry a mosaic edge (${strips}/${pages})`);
  assert.ok(photos > 0);
});

test("a deck's own words follow its language, and a Russian deck is set only in faces with every Russian letter", async () => {
  const { CHROME, facesFor, hasCyrillic, deckNumber, ANSWER_IN } = await import(`${edge}/glass/language.js`);
  const { CYRILLIC_FAMILIES } = await import(`${edge}/glass/metrics.js`);
  const { outlinePrompt, contentPrompt } = await import(`${edge}/glass/content.js`);

  assert.equal(hasCyrillic("Сунъий интеллект"), true);
  assert.equal(hasCyrillic("Ўзбекистон иқтисодиёти"), true);
  assert.equal(hasCyrillic("Sun’iy intellektning ta’limdagi o‘rni"), false);
  assert.equal(hasCyrillic("Marketing 2024: 37% o‘sish, x² + y² = r²"), false);
  assert.equal(deckNumber(2.5, "en"), "2.5");
  assert.equal(deckNumber(2.5, "ru"), "2,5");
  assert.equal(CHROME.ru.sections(1), "1 основной раздел");
  assert.equal(CHROME.ru.sections(3), "3 основных раздела");
  assert.equal(CHROME.ru.sections(12), "12 основных разделов");
  assert.match(outlinePrompt({ language: "en", topic: "t", count: 5, research: "", requirements: "", attachments: false }), /English/);
  assert.match(contentPrompt({ language: "ru", topic: "t", slides: [], research: "", requirements: "" }), /русском/);
  assert.ok(ANSWER_IN.uz.includes("o‘zbek"));

  // Every style picks only Cyrillic faces for a Russian deck — mozaika's Poppins included.
  for (const style of ["glass", "editorial", "soft3d", "corporate", "naqsh", "spektr", "mozaika"]) {
    for (let seed = 1; seed <= 12; seed += 1) {
      const direction = readArtDirection({ mode: seed % 2 ? "dark" : "light", hue: seed * 29, mood: MOODS[seed % MOODS.length], typography: ["serif", "sans", "mixed"][seed % 3], energy: "vivid" }, "t");
      const dna = buildDNA({ direction, seed, available: facesFor("ru", available), style });
      for (const pick of Object.values(dna.fonts)) {
        assert.ok(CYRILLIC_FAMILIES.has(pick.family), `${style}/${seed}: ${pick.family} cannot draw Russian`);
      }
    }
  }

  for (const [language, words] of [["ru", CHROME.ru], ["en", CHROME.en]]) {
    const dna = buildDNA({ direction: readArtDirection({ mode: "light", hue: 210, mood: "corporate", typography: "sans", energy: "calm" }, "t"), seed: 7, available: facesFor(language, available), style: "glass" });
    const outline = readOutline({ shortTitle: "Short", subtitle: "Subtitle", coverQuery: "x", slides: [
      { title: language === "ru" ? "Искусственный интеллект в образовании" : "Artificial intelligence in education", kind: "cards", focus: "f", imageQuery: null },
      { title: language === "ru" ? "Цифры и факты" : "Facts and figures", kind: "chart", focus: "f", imageQuery: null },
    ] }, { topic: "t", count: 2 });
    const slides = outline.slides.map((entry) => readSlide({
      title: entry.title, lead: language === "ru" ? "Длинное предложение о том, как технологии меняют обучение и работу учителя каждый день." : "A long sentence about how technology changes learning and teaching every day.",
      points: [1, 2, 3].map((n) => ({ title: (language === "ru" ? "Пункт " : "Point ") + n, text: language === "ru" ? "Подробное объяснение этого пункта на русском языке." : "A detailed explanation of this point in English." })),
      chart: { labels: ["A", "B", "C"], values: [12.5, 40, 47.5], unit: "%", insight: "x" },
    }, entry));
    const deck = composeDeck({ dna, face, language, topic: language === "ru" ? "Тема" : "Topic", shortTitle: "Short", subtitle: "Sub", author: "A", teacher: "B", year: 2026, slides, sources: [], cover: null, pictures: new Map() });
    const all = deck.flatMap((page) => page.rows.filter((row) => row.type === "text").map((row) => String(row.content.text)));
    for (const expected of [words.agenda, words.references, words.thanks]) {
      assert.ok(all.some((text) => text.toLowerCase().includes(expected.toLowerCase())), `${language}: “${expected}” is on the deck`);
    }
    assert.ok(!all.some((text) => /Mavzular rejasi|Foydalanilgan adabiyotlar|rahmat/.test(text)), `${language}: no Uzbek chrome is left`);
    for (const page of deck) assert.deepEqual(pageFaults(page.rows), [], `${language} ${page.layout}: clean page`);
  }
});
