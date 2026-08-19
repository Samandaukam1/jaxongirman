import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { MAX_FONT_BYTES, faceFileName, isFontFile, looksLikeFont, normaliseFamily, readStylesheet, stylesheetRequest } =
  await import(`${edge}/font-source.js`);

/**
 * Fetching the file a template asked for.
 *
 * The whole of this is one sentence with three dangerous words in it: a server
 * makes a request to an outside host using a name that came from a file
 * somebody uploaded. These tests are about those three words.
 */

test("the family name is a query value, so it cannot become a path", () => {
  const { url } = stylesheetRequest({ family: "../../../etc/passwd", weights: [400], italics: false });
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "fonts.googleapis.com");
  assert.equal(parsed.pathname, "/css2");
  assert.ok(!parsed.pathname.includes(".."));
  assert.ok(parsed.searchParams.get("family").startsWith("../../../etc/passwd:"));
});

test("a family with spaces and an ampersand survives escaping intact", () => {
  const { url } = stylesheetRequest({ family: "Libre Baskerville & Co", weights: [400], italics: false });
  assert.equal(new URL(url).searchParams.get("family"), "Libre Baskerville & Co:wght@400");
});

test("italics are asked for on both axes, not as a second family", () => {
  const { url } = stylesheetRequest({ family: "Inter", weights: [400, 700], italics: true });
  assert.equal(new URL(url).searchParams.get("family"), "Inter:ital,wght@0,400;0,700;1,400;1,700");
});

test("the request asks as an old browser, because a modern one is served WOFF2", () => {
  // WOFF2 is the one format the PDF exporter cannot embed.
  const { headers } = stylesheetRequest({ family: "Inter", weights: [400], italics: false });
  assert.ok(/Chrome\/12\b/.test(headers["User-Agent"]));
});

const CSS = `
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/v13/regular.ttf) format('truetype');
}
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/inter/v13/bolditalic.ttf) format('truetype');
}
`;

test("each face is read with its own weight and slope", () => {
  const faces = readStylesheet(CSS);
  assert.equal(faces.length, 2);
  assert.deepEqual(faces[0], { url: "https://fonts.gstatic.com/s/inter/v13/regular.ttf", weight: 400, italic: false, format: "ttf" });
  assert.equal(faces[1].italic, true);
  assert.equal(faces[1].weight, 700);
});

test("a WOFF2 face is skipped rather than stored as one nobody can embed", () => {
  const css = `@font-face { font-weight: 400; src: url(https://fonts.gstatic.com/s/inter/a.woff2) format('woff2'); }`;
  assert.deepEqual(readStylesheet(css), []);
});

test("a face served from another host is not a face this will fetch", () => {
  const css = `@font-face { font-weight: 400; src: url(https://cdn.example.com/a.ttf) format('truetype'); }`;
  assert.deepEqual(readStylesheet(css), []);
});

test("a host that merely ends with the real one is refused", () => {
  assert.equal(isFontFile("https://fonts.gstatic.com.example.com/a.ttf"), false);
  assert.equal(isFontFile("https://fonts.gstatic.com/a.ttf"), true);
});

test("plain http is refused however right the host looks", () => {
  assert.equal(isFontFile("http://fonts.gstatic.com/a.ttf"), false);
});

test("something that is not a URL at all is refused rather than thrown on", () => {
  assert.equal(isFontFile("s/inter/v13/regular.ttf"), false);
  assert.equal(isFontFile(""), false);
});

test("the same face listed twice is one file", () => {
  const twice = CSS + CSS;
  assert.equal(readStylesheet(twice).length, 2);
});

test("an error page returned with a 200 is not stored as a font", () => {
  const html = new TextEncoder().encode("<!doctype html><html>404</html>");
  assert.equal(looksLikeFont(html), false);
});

test("the real font signatures are recognised", () => {
  assert.equal(looksLikeFont(new Uint8Array([0x00, 0x01, 0x00, 0x00, 9])), true);
  assert.equal(looksLikeFont(new TextEncoder().encode("OTTO....")), true);
  assert.equal(looksLikeFont(new TextEncoder().encode("true....")), true);
});

test("too few bytes to tell is not a font", () => {
  assert.equal(looksLikeFont(new Uint8Array([0, 1])), false);
});

test("there is a ceiling, and it is smaller than a picture", () => {
  assert.ok(MAX_FONT_BYTES <= 8 * 1024 * 1024);
});

test("one family has one shelf however it was spelled", () => {
  const spellings = ["Playfair Display", "playfair display", "PlayfairDisplay", "Playfair  Display"];
  assert.equal(new Set(spellings.map(normaliseFamily)).size, 1);
});

test("two different families do not share a shelf", () => {
  assert.notEqual(normaliseFamily("Inter"), normaliseFamily("Inter Tight"));
});

test("the stored name is built here, never taken from the URL", () => {
  assert.equal(faceFileName("font_1", 700, true, "ttf"), "font_1-700i.ttf");
  assert.equal(faceFileName("font_2", 400, false, "otf"), "font_2-400.otf");
});
