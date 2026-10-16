import assert from "node:assert/strict";
import test from "node:test";

import { GAME_AVATAR_COUNT, GAME_AVATARS, gameAvatar, gameAvatarArt } from "../src/avatars.ts";

const NUMBER = /-?\d*\.?\d+/g;

test("there is a recipe for every id a player can hold", () => {
  assert.equal(GAME_AVATARS.length, GAME_AVATAR_COUNT);
  assert.equal(gameAvatar(-1), GAME_AVATARS[0]);
  assert.equal(gameAvatar(999), GAME_AVATARS[0]);
  assert.equal(gameAvatar(1.5), GAME_AVATARS[0]);
});

test("every portrait draws only what it declares", () => {
  const seen = new Set();
  for (let id = 0; id < GAME_AVATAR_COUNT; id += 1) {
    const art = gameAvatarArt(id);
    const ids = new Set(art.defs.map((def) => def.id));
    assert.equal(ids.size, art.defs.length, `avatar ${id} declares an id twice`);
    for (const defId of ids) {
      // Two characters on one web page share a document: their ids must not collide.
      assert.ok(!seen.has(defId), `avatar ${id} reuses ${defId}`);
      seen.add(defId);
    }
    assert.ok(ids.has(art.frame), `avatar ${id} is cut to a frame it never declared`);

    for (const shape of art.shapes) {
      for (const paint of [shape.fill, shape.stroke]) {
        const ref = typeof paint === "string" ? paint.match(/^url\(#(.+)\)$/) : null;
        if (ref) assert.ok(ids.has(ref[1]), `avatar ${id} paints with missing ${ref[1]}`);
      }
      if (shape.clip) assert.ok(ids.has(shape.clip), `avatar ${id} clips to missing ${shape.clip}`);
      assert.ok(shape.fill !== undefined || shape.stroke !== undefined, `avatar ${id} has an invisible ${shape.kind}`);

      const numbers = shape.kind === "path"
        ? (shape.d.match(NUMBER) ?? []).map(Number)
        : Object.entries(shape).filter(([key]) => ["cx", "cy", "r", "rx", "ry", "x", "y", "w", "h"].includes(key)).map(([, value]) => value);
      for (const value of numbers) assert.ok(Number.isFinite(value), `avatar ${id} has a non-finite coordinate in a ${shape.kind}`);
    }
  }
});

test("the grid is a mix: every skin tone, girls and boys, ro‘mol and do‘ppi", () => {
  assert.deepEqual(new Set(GAME_AVATARS.map((spec) => spec.skin)), new Set([0, 1, 2, 3, 4]));
  assert.ok(GAME_AVATARS.slice(0, 20).some((spec) => spec.style === "headscarf"));
  assert.ok(GAME_AVATARS.some((spec) => spec.accessories.includes("doppi")));
  assert.ok(GAME_AVATARS.some((spec) => spec.accessories.includes("gulliDoppi")));
  assert.ok(GAME_AVATARS.slice(20).some((spec) => spec.accessories.includes("beard")));
});

test("every quick pick has characters in it, and Hammasi has all of them", async () => {
  const { GAME_AVATAR_GROUPS, gameAvatarIds } = await import("../src/avatars.ts");
  for (const group of GAME_AVATAR_GROUPS) assert.ok(gameAvatarIds(group.key).length >= 4, group.key);
  assert.equal(gameAvatarIds("all").length, GAME_AVATAR_COUNT);
});
