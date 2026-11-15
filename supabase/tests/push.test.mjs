import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { chunks, messagesFor, readOutcome, sameSecret } = await import(`${edge}/push.js`);

/**
 * The dispatcher's arithmetic: one message per phone, a hundred to a request,
 * a push sent when any of its phones took it, and a phone that is gone
 * forgotten rather than tried forever.
 */

const rows = [
  { id: 1, title: "Aziza", body: "Salom", data: { url: "/chat/c1", conversation_id: "c1" }, channel: "chat", tokens: ["T-a", "T-b"] },
  { id: 2, title: "O‘yin", body: "Do‘konda", data: { url: "/oyingoh" }, channel: "default", tokens: ["T-c"] },
  { id: 3, title: "Hech kim", body: "", data: {}, channel: "default", tokens: [] },
];

test("one message per phone, a conversation's grouped by its thread", () => {
  const messages = messagesFor(rows);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map((entry) => entry.row), [1, 1, 2]);
  assert.equal(messages[0].message.channelId, "chat");
  assert.equal(messages[0].message.threadId, "c1");
  assert.equal(messages[2].message.channelId, "default");
  assert.equal(messages[2].message.threadId, undefined);
});

test("a hundred to a request", () => {
  assert.deepEqual(chunks(Array.from({ length: 250 }, (_, at) => at)).map((batch) => batch.length), [100, 100, 50]);
});

test("a push is sent if any of its phones took it; a gone phone is forgotten", () => {
  const messages = messagesFor(rows);
  const outcome = readOutcome(rows, messages, [
    { status: "error", details: { error: "DeviceNotRegistered" } },
    { status: "ok", id: "x" },
    { status: "error", message: "rate limited" },
  ]);
  assert.deepEqual(outcome.sent.sort(), [1, 3], "1 — bitta telefon oldi; 3 — telefoni yo‘q, tugadi");
  assert.deepEqual(outcome.failed, { 2: "rate limited" });
  assert.deepEqual(outcome.dead, ["T-a"]);
});

test("a push whose only phones are all gone is done, not retried", () => {
  const only = [{ ...rows[1], tokens: ["T-c"] }];
  const outcome = readOutcome(only, messagesFor(only), [{ status: "error", details: { error: "DeviceNotRegistered" } }]);
  assert.deepEqual(outcome.sent, [2]);
  assert.deepEqual(outcome.dead, ["T-c"]);
});

test("a missing ticket is a failure, not a success", () => {
  const outcome = readOutcome([rows[1]], messagesFor([rows[1]]), []);
  assert.deepEqual(outcome.failed, { 2: "no ticket" });
});

test("the shared secret must match exactly", () => {
  assert.equal(sameSecret("abc123", "abc123"), true);
  assert.equal(sameSecret("abc124", "abc123"), false);
  assert.equal(sameSecret("", ""), false, "sozlanmagan sir — hech kimga ruxsat yo‘q");
  assert.equal(sameSecret("abc", "abc123"), false);
});
