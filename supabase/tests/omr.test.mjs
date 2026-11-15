import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { sheetLayout, encodeSheetCode, decodeSheetCode, testFingerprint } = await import(`${edge}/test-sheet.js`);
const { readSheet, toGray } = await import(`${edge}/omr.js`);

/**
 * The scanner against photographs made here: the sheet drawn as the PDF draws
 * it, then put into a "photo" — tilted, in perspective, on a dark table, lit
 * unevenly, with sensor noise and JPEG compression — and read back. Every case
 * must come back exactly as filled, or say plainly that it cannot.
 */

const PAPER = 238;
const INK = 22;

/** A seeded generator, so a failure can be run again. */
function random(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Paper round the panel, as the page has it: never less than this many points. */
const QUIET = 24;

/** The panel at `scale` pixels per point, on its paper, filled in as `answers` says. */
function drawSheet(layout, { answers, fingerprint, scale = 4, pen = INK, extraMarks = [] }) {
  const W = Math.round((layout.width + QUIET * 2) * scale);
  const H = Math.round((layout.height + QUIET * 2) * scale);
  const data = new Uint8Array(W * H).fill(PAPER);
  const rect = (x, y, w, h, v) => {
    x += QUIET; y += QUIET;
    for (let yy = Math.max(0, Math.round(y * scale)); yy < Math.min(H, Math.round((y + h) * scale)); yy += 1)
      for (let xx = Math.max(0, Math.round(x * scale)); xx < Math.min(W, Math.round((x + w) * scale)); xx += 1) data[yy * W + xx] = v;
  };
  const disc = (cx, cy, r, v, inner = 0) => {
    cx += QUIET; cy += QUIET;
    for (let yy = Math.floor((cy - r) * scale); yy <= Math.ceil((cy + r) * scale); yy += 1)
      for (let xx = Math.floor((cx - r) * scale); xx <= Math.ceil((cx + r) * scale); xx += 1) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const d = Math.hypot(xx / scale - cx, yy / scale - cy);
        if (d <= r && d >= inner) data[yy * W + xx] = Math.min(data[yy * W + xx], v);
      }
  };
  const square = (p, side) => rect(p.x - side / 2, p.y - side / 2, side, side, INK);
  layout.markers.forEach((p) => square(p, layout.markerSize));
  layout.middles.forEach((p) => square(p, layout.middleSize));
  square(layout.orientation, layout.orientationSize);
  encodeSheetCode({ questions: layout.questions, options: layout.options, fingerprint })
    .forEach((bit, at) => { if (bit) square(layout.code[at], layout.codeSize); });
  // The header's words and each row's number: ink that is not a bubble.
  for (let line = 0; line < 3; line += 1) rect(layout.header.left, layout.header.top + 10 + line * 18, 180 - line * 40, 6, 60);
  layout.labels.forEach((label) => rect(label.x - 9, label.y - 3, 9, 6, 50));
  for (const bubble of layout.bubbles) {
    disc(bubble.x, bubble.y, bubble.r, 120, bubble.r - 0.7);       // the printed ring
    disc(bubble.x, bubble.y, bubble.r * 0.32, 185);                 // the light letter inside
    if (answers[bubble.question]?.includes?.(bubble.option) || answers[bubble.question] === bubble.option) {
      disc(bubble.x, bubble.y, bubble.r * 0.9, pen);
    }
  }
  for (const mark of extraMarks) mark({ rect, disc });
  return { width: W, height: H, data, scale };
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** The perspective taking four photo corners back to four sheet corners (pixels of the drawing). */
function inverseHomography(photo, sheet) {
  const A = []; const b = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = photo[i]; const [u, v] = sheet[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return (x, y) => {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };
}

/**
 * The drawing photographed: `corners` are where the sheet's corners land in a
 * `size` photo; `fold` bends the lower half by that many pixels.
 */
function photograph(sheet, { size = [1200, 1600], corners, light = [0.62, 1.05], noise = 7, seed = 1, fold = 0, clutter = [], blur = 0, shadow = null, glare = null }) {
  const [PW, PH] = size;
  const next = random(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(next() + 1e-9)) * Math.cos(2 * Math.PI * next());
  const sheetCorners = [[0, 0], [sheet.width, 0], [sheet.width, sheet.height], [0, sheet.height]];
  const map = inverseHomography(corners, sheetCorners);
  const out = new Uint8Array(PW * PH);
  for (let y = 0; y < PH; y += 1) {
    for (let x = 0; x < PW; x += 1) {
      let [u, v] = map(x, y);
      if (fold && v > sheet.height / 2) u += fold * ((v - sheet.height / 2) / (sheet.height / 2)) ** 2 * 4;
      let value;
      if (u >= 0 && v >= 0 && u < sheet.width - 1 && v < sheet.height - 1) {
        const x0 = Math.floor(u); const y0 = Math.floor(v); const dx = u - x0; const dy = v - y0;
        const i = y0 * sheet.width + x0; const d = sheet.data;
        value = (d[i] * (1 - dx) + d[i + 1] * dx) * (1 - dy) + (d[i + sheet.width] * (1 - dx) + d[i + sheet.width + 1] * dx) * dy;
      } else {
        value = 70 + 25 * Math.sin(x / 37) * Math.cos(y / 53);            // a wooden-ish table
      }
      for (const box of clutter) if (x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3]) value = 15;
      let lit = light[0] + (light[1] - light[0]) * ((x / PW) * 0.7 + (y / PH) * 0.3);
      // A hand's shadow: a soft dark band across the picture.
      if (shadow) {
        const d = (x * shadow.nx + y * shadow.ny - shadow.at) / shadow.soft;
        lit *= 1 - shadow.depth / (1 + Math.exp(-d));
      }
      // A lamp's glare: a bright patch that washes the paper out.
      if (glare) lit += glare.strength * Math.exp(-((x - glare.x) ** 2 + (y - glare.y) ** 2) / (2 * glare.size ** 2));
      out[y * PW + x] = Math.max(0, Math.min(255, Math.round(value * lit + gauss() * noise)));
    }
  }
  // Out of focus: a box blur, `blur` pixels each way, twice.
  for (let pass = 0; pass < (blur ? 2 : 0); pass += 1) {
    const copy = out.slice();
    for (let y = blur; y < PH - blur; y += 1) {
      for (let x = blur; x < PW - blur; x += 1) {
        let sum = 0;
        for (let dy = -blur; dy <= blur; dy += 1) for (let dx = -blur; dx <= blur; dx += 1) sum += copy[(y + dy) * PW + x + dx];
        out[y * PW + x] = sum / (2 * blur + 1) ** 2;
      }
    }
  }
  return { width: PW, height: PH, data: out };
}

/** Through a real JPEG encoder and decoder, as a phone would send it. */
async function jpeg(image, quality = 72) {
  const encoded = await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 1 } })
    .jpeg({ quality }).toBuffer();
  const { data, info } = await sharp(encoded).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return toGray(data, info.width, info.height, info.channels);
}

function answersFor(questions, options, seed, blanks = []) {
  const next = random(seed);
  return Array.from({ length: questions }, (_, q) => (blanks.includes(q) ? null : Math.floor(next() * options)));
}

/** The paper's corners for a panel `w` wide, so the panel itself is `w` wide in the photo. */
const tilt = (cx, cy, w, h, angle, keystone = 0) => {
  const k = w / 350;
  w += QUIET * 2 * k; h += QUIET * 2 * k;
  const c = Math.cos(angle); const s = Math.sin(angle);
  return [[-w / 2 + keystone, -h / 2], [w / 2 - keystone, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};

async function scan({ questions = 20, options = 4, seed = 1, blanks = [], photo = {}, pen, extraMarks, compress = true, fingerprint = 0x5a3, expect }) {
  const layout = sheetLayout(questions, options);
  const answers = answersFor(questions, options, seed, blanks);
  const sheet = drawSheet(layout, { answers, fingerprint, pen, extraMarks });
  const shot = photograph(sheet, { seed, corners: tilt(600, 800, 900, 900 * layout.height / layout.width, 0.03), ...photo });
  const image = compress ? await jpeg(shot) : shot;
  const result = readSheet(image, expect ?? { questions, options, fingerprint }, process.env.OMR_DEBUG ? (e, d) => console.log(e, JSON.stringify(d).slice(0, 700)) : undefined);
  return { answers, result };
}

test("the code strip: what is written is what is read, and a damaged strip is refused", () => {
  const code = { questions: 37, options: 5, fingerprint: 0xabc };
  assert.deepEqual(decodeSheetCode(encodeSheetCode(code)), code);
  const bits = encodeSheetCode(code);
  bits[5] = !bits[5];
  assert.equal(decodeSheetCode(bits), null);
  assert.equal(decodeSheetCode(new Array(24).fill(false)), null, "blank paper is no code");
  assert.equal(decodeSheetCode(new Array(24).fill(true)), null, "a black strip is no code");
  assert.ok(testFingerprint("6f1c2b4e-0000-4000-8000-000000000001") !== testFingerprint("6f1c2b4e-0000-4000-8000-000000000002"));
});

test("every bubble fits its sheet: inside the grid, clear of the squares, none touching", () => {
  for (const [q, k] of [[1, 3], [10, 4], [15, 5], [16, 4], [40, 4], [41, 5], [60, 5], [60, 3]]) {
    const layout = sheetLayout(q, k);
    assert.equal(layout.bubbles.length, q * k);
    for (const bubble of layout.bubbles) {
      assert.ok(bubble.x - bubble.r > layout.markerSize + 4 && bubble.x + bubble.r < layout.width - layout.markerSize - 4, `${q}×${k} x`);
      assert.ok(bubble.y - bubble.r > layout.header.bottom && bubble.y + bubble.r < layout.height - layout.markerSize - 4, `${q}×${k} y`);
      assert.ok(bubble.r >= 4.5, `${q}×${k}: bubbles large enough to fill (r=${bubble.r.toFixed(1)}pt)`);
    }
    for (const a of layout.bubbles) for (const b of layout.bubbles) {
      if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 2, `${q}×${k}: bubbles apart`);
    }
  }
});

test("a straight, well lit photo is read exactly, blanks included", async () => {
  const { answers, result } = await scan({ blanks: [3, 11], photo: { light: [1, 1], noise: 2 } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.answers, answers);
  assert.ok(result.flags.every((flag) => flag === null), JSON.stringify(result.flags));
});

test("tilted 14°, in perspective, lit from one side, noisy and compressed: still exact", async () => {
  const layout = sheetLayout(25, 4);
  const corners = tilt(610, 790, 820, 820 * layout.height / layout.width, 0.24, 70);
  const { answers, result } = await scan({ questions: 25, seed: 7, blanks: [0], photo: { corners, light: [0.5, 1.08], noise: 9 } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.answers, answers);
});

test("upside down: read the right way round", async () => {
  const layout = sheetLayout(20, 4);
  const corners = tilt(600, 800, 900, 900 * layout.height / layout.width, Math.PI + 0.05);
  const { answers, result } = await scan({ seed: 3, photo: { corners } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.answers, answers);
});

test("sideways, the phone held in landscape: read the right way round", async () => {
  const layout = sheetLayout(20, 4);
  const corners = tilt(800, 600, 760, 760 * layout.height / layout.width, Math.PI / 2 - 0.04);
  const { answers, result } = await scan({ seed: 13, photo: { size: [1600, 1200], corners } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.answers, answers);
});

test("a light pencil is read as well as a pen", async () => {
  const { answers, result } = await scan({ seed: 5, pen: 128, photo: { noise: 8 } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.answers, answers);
});

test("sixty questions with five options, the sheet small in the photo", async () => {
  const layout = sheetLayout(60, 5);
  const corners = tilt(600, 800, 560, 560 * layout.height / layout.width, -0.08, 30);
  const { answers, result } = await scan({ questions: 60, options: 5, seed: 11, blanks: [59], photo: { corners } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.answers, answers);
});

test("a sheet folded across the middle is followed by its edge squares", async () => {
  const { answers, result } = await scan({ questions: 30, seed: 17, photo: { fold: 3 } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.answers, answers);
});

test("black things on the table near the sheet do not pass for its corners", async () => {
  const { answers, result } = await scan({ seed: 19, photo: { clutter: [[40, 40, 60, 60], [1110, 1500, 70, 70], [40, 1480, 55, 55]] } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.answers, answers);
});

test("two bubbles filled in one row: no answer, and the row is flagged", async () => {
  const layout = sheetLayout(10, 4);
  const answers = answersFor(10, 4, 23);
  answers[4] = [0, 2];
  const sheet = drawSheet(layout, { answers, fingerprint: 0x111 });
  const image = await jpeg(photograph(sheet, { corners: tilt(600, 800, 900, 900 * layout.height / layout.width, 0.02) }));
  const result = readSheet(image, { questions: 10, options: 4, fingerprint: 0x111 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.answers[4], null);
  assert.equal(result.flags[4], "multiple");
  answers.forEach((answer, q) => { if (q !== 4) assert.equal(result.answers[q], answer, `question ${q + 1}`); });
});

test("another test's sheet is refused, not graded", async () => {
  const { result } = await scan({ fingerprint: 0x123, expect: { questions: 20, options: 4, fingerprint: 0x456 } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "other_test");
  assert.deepEqual(result.read, { questions: 20, options: 4, fingerprint: 0x123 });
});

test("the same test with a question added after printing is refused too", async () => {
  const { result } = await scan({ questions: 20, expect: { questions: 21, options: 4, fingerprint: 0x5a3 } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "other_test");
});

test("a photo with no sheet in it says so", () => {
  const blank = { width: 900, height: 1200, data: new Uint8Array(900 * 1200).fill(200) };
  const result = readSheet(blank, { questions: 10, options: 4, fingerprint: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "no_markers");
});

test("an empty sheet is empty: nothing invented", async () => {
  const blanks = Array.from({ length: 20 }, (_, q) => q);
  const { result } = await scan({ blanks });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.answers.every((answer) => answer === null), JSON.stringify(result.answers));
});

test("forty hard photographs at random: tilt, perspective, light, shadow, glare, blur, noise, ink, compression", async () => {
  const failures = [];
  for (let run = 0; run < Number(process.env.OMR_SWEEP ?? 40); run += 1) {
    const next = random(1000 + run);
    const questions = [10, 20, 30, 45, 60][Math.floor(next() * 5)];
    const options = [3, 4, 5][Math.floor(next() * 3)];
    const layout = sheetLayout(questions, options);
    const portrait = next() < 0.75;
    const size = portrait ? [1200, 1600] : [1600, 1200];
    const width = 520 + next() * 380;
    const height = width * layout.height / layout.width;
    const angle = (portrait ? 0 : Math.PI / 2) + (next() - 0.5) * 0.5 + (next() < 0.15 ? Math.PI : 0);
    const corners = tilt(size[0] / 2 + (next() - 0.5) * 80, size[1] / 2 + (next() - 0.5) * 80, width, height, angle, next() * 60);
    const answers = answersFor(questions, options, run + 1, [Math.floor(next() * questions)]);
    const sheet = drawSheet(layout, { answers, fingerprint: 0x2f1, pen: 22 + Math.floor(next() * 110) });
    const photo = photograph(sheet, {
      size, corners, seed: run + 7,
      light: [0.45 + next() * 0.4, 0.95 + next() * 0.15],
      noise: 3 + next() * 9,
      blur: next() < 0.5 ? 1 : 0,
      shadow: next() < 0.35 ? { nx: 0.8, ny: 0.6, at: 600 + next() * 900, soft: 40 + next() * 60, depth: 0.25 + next() * 0.2 } : null,
      glare: next() < 0.25 ? { x: next() * size[0], y: next() * size[1], size: 120 + next() * 120, strength: 0.25 + next() * 0.2 } : null,
    });
    const result = readSheet(await jpeg(photo, 55 + Math.floor(next() * 30)), { questions, options, fingerprint: 0x2f1 });
    if (!result.ok) {
      failures.push(`#${run} ${questions}×${options}: ${result.code}`);
      continue;
    }
    const wrong = answers.map((answer, q) => (result.answers[q] === answer ? null : `${q + 1}: ${answer}→${result.answers[q]}`)).filter(Boolean);
    // A doubtful row may be flagged for the teacher; a wrong row that is not flagged is a failure.
    const silent = wrong.filter((line) => result.flags[Number(line.split(":")[0]) - 1] === null);
    if (silent.length) failures.push(`#${run} ${questions}×${options}: ${silent.join(", ")}`);
  }
  assert.deepEqual(failures, []);
});
