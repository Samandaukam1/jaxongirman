import assert from "node:assert/strict";
import test from "node:test";

import { emptyPromoBlock, normalizePromoBody, normalizePromoTheme, parseInline, plainInline, promoBadgeText } from "../src/promo.ts";

const looks = (source) => parseInline(source).map((span) => Object.fromEntries(
  Object.entries(span).filter(([, value]) => value !== false && value !== null),
));

test("plain text is one run", () => {
  assert.deepEqual(looks("Salom dunyo"), [{ text: "Salom dunyo" }]);
});

test("bold, italic, underline and strike toggle", () => {
  assert.deepEqual(looks("a **b** *c* __d__ ~~e~~"), [
    { text: "a " }, { text: "b", bold: true }, { text: " " }, { text: "c", italic: true },
    { text: " " }, { text: "d", underline: true }, { text: " " }, { text: "e", strike: true },
  ]);
});

test("colour and highlight nest, and {/} closes the innermost", () => {
  assert.deepEqual(looks("{bg:#ffe66d}{#2563eb}ikki{/}bitta{/}oddiy"), [
    { text: "ikki", color: "#2563EB", highlight: "#FFE66D" },
    { text: "bitta", highlight: "#FFE66D" },
    { text: "oddiy" },
  ]);
});

test("a link keeps the style round it and may hold marks of its own", () => {
  assert.deepEqual(looks("**[a *b*](https://x.uz)**"), [
    { text: "a ", bold: true, href: "https://x.uz" },
    { text: "b", bold: true, italic: true, href: "https://x.uz" },
  ]);
});

test("an app route with parentheses is one link", () => {
  assert.deepEqual(looks("[ochish](/(app)/create)"), [{ text: "ochish", href: "/(app)/create" }]);
});

test("a link to anything but http(s) or an app route stays text", () => {
  assert.equal(plainInline("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
});

test("a backslash types a mark literally", () => {
  assert.deepEqual(looks("\\*bu\\* yulduz"), [{ text: "*bu* yulduz" }]);
});

test("the body drops what it cannot draw and repairs what it can", () => {
  const body = normalizePromoBody([
    { type: "text", text: "x" },
    { type: "unknown" },
    null,
    { type: "image", url: "ftp://nope" },
    { type: "button", button: { label: "Go", colors: ["#ff0000"], glow: true } },
  ]);
  assert.equal(body.length, 3);
  assert.equal(body[1].type, "image");
  assert.equal(body[1].url, "", "an address that is not http(s) is removed");
  assert.deepEqual(body[2].button.colors, ["#FF0000", "#FF0000"]);
  assert.equal(body[2].button.glow, true);
  assert.equal(body[2].button.pinned, false);
});

test("a theme falls back to the defaults", () => {
  assert.deepEqual(normalizePromoTheme({ font: "comic", accent: "red" }), { font: "editorial", accent: "#6C34C9" });
});

test("every block type has an empty form the normaliser accepts", () => {
  for (const type of ["heading", "text", "quote", "callout", "image", "video", "audio", "list", "divider", "button"]) {
    const block = emptyPromoBlock(type);
    assert.equal(normalizePromoBody([block])[0].type, type);
  }
});

test("a banner's label: default by kind, hidden, or the console's own words", () => {
  assert.equal(promoBadgeText({ kind: "ad", badge: null }, "REKLAMA"), "REKLAMA");
  assert.equal(promoBadgeText({ kind: "recommendation", badge: null }, "REKLAMA"), null);
  assert.equal(promoBadgeText({ kind: "ad", badge: "" }, "REKLAMA"), null);
  assert.equal(promoBadgeText({ kind: "recommendation", badge: " YANGI " }, "REKLAMA"), "YANGI");
});
