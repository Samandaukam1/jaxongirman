import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Two screens must not draw the same noun two different ways.
 *
 * Profil counts presentations and J Tanga, and both already have a drawing
 * elsewhere — the slide stack on Loyihalar, the coin on Bosh sahifa. Profil now
 * shows the counts as figures alone; what must never happen is a generic Lucide
 * `Presentation` or `Coins` creeping in beside them, which is how an app ends
 * up with two coins without anything looking broken.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const PROFILE = "app/(app)/(tabs)/profile.tsx";

test("Profil never draws Taqdimot or J Tanga with a generic glyph", () => {
  const profile = read(PROFILE);
  for (const generic of ["Presentation", "Coins"]) {
    assert.ok(
      !new RegExp(`\\b${generic}\\b[^\\n]*from "lucide-react-native"`).test(profile)
        && !new RegExp(`glyph:\\s*${generic}\\b`).test(profile),
      `Profil umumiy ${generic} ikonkasini ishlatyapti`,
    );
  }
  // If the coin is ever drawn here again, it is the coin the wallet draws.
  const coin = /import\s+\w+\s+from\s+"([^"]*coin[^"]*)"/i.exec(profile);
  if (coin) assert.match(coin[1], /assets\/coin\/coin-icon\.png$/, "Profil boshqa tanga rasmini ishlatyapti");
});

/**
 * One way to the tariff, and one way of drawing a row.
 *
 * The screen this replaced reached the tariff three times — a header tile, a
 * "Premium tarif" strip and a settings row — and drew every control in its own
 * hue, which read as busy rather than rich. The tariff is now one Sozlamalar
 * row, and every row's tile is drawn by one component in one ink; red is kept
 * for deleting the account. Both regress quietly, by somebody adding a shortcut
 * or a colour to one row, so both are counted.
 */
test("Profil reaches the tariff once and draws every menu row the same way", () => {
  const profile = read(PROFILE);
  const card = read("src/components/PlanUsageCard.tsx");

  const routes = [...profile.matchAll(/"\/\(app\)\/tarif"/g)];
  assert.equal(routes.length, 1, `Profilda tarifga ${routes.length} ta yo‘l bor`);
  assert.ok(!/Premium tarif/.test(card), "PlanUsageCard yana “Premium tarif” qatorini chizyapti");

  const block = profile.slice(profile.indexOf("const SETTINGS = ["), profile.indexOf("] as const satisfies", profile.indexOf("const SETTINGS = [")));
  // Rows name their words by key in the `profile` table, one key per row.
  const rows = [...block.matchAll(/key:\s*"/g)];
  // Tariff, products, earnings, orders, cards — and "Web ulash", "Qurilmalar" (2026-10-17).
  assert.equal(rows.length, 7, "Sozlamalar qatorlari soni o‘zgargan");
  assert.ok(!/accent:|color:|gradient/i.test(block), "Sozlamalar qatorlariga alohida rang qaytgan");
  assert.ok(!/AccentIcon/.test(profile), "Profil yana har xil rangli ikonkalarga qaytgan");

  // Every tile on the screen goes through Tile, and only deletion is red.
  const tones = [...profile.matchAll(/<Tile\b[^>]*tone="(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(tones.filter((tone) => tone === "danger").length, 1, "qizil faqat o‘chirishda bo‘lishi kerak");
});

/**
 * A permanent action must not be reachable by one press.
 *
 * The button opens a sheet; the sheet is what calls the server. This checks the
 * wiring rather than the words: `onPress` on the red button may only set the
 * confirmation state, and the only call to `deleteMyAccount` in the app lives
 * behind that sheet.
 */
test("the delete button opens a confirmation and never deletes on its own", () => {
  const profile = read(PROFILE);
  const sheet = read("src/components/DeleteAccountSheet.tsx");

  assert.ok(!/deleteMyAccount/.test(profile), "Profil to‘g‘ridan-to‘g‘ri o‘chirishni chaqirmasligi kerak");
  assert.match(profile, /onPress=\{\(\) => setConfirmingDelete\(true\)\}/, "qizil tugma tasdiqlash oynasini ochishi kerak");
  assert.match(profile, /<DeleteAccountSheet\s/, "tasdiqlash oynasi ulanmagan");

  // The words live in the `misc` table; the sheet must still draw both buttons.
  assert.match(sheet, /t\("deleteAccount\.cancel"\)/, "bekor qilish tugmasi yo‘q");
  assert.match(sheet, /t\("deleteAccount\.confirm"\)/, "tasdiqlovchi tugma yozuvi yo‘q");
  assert.match(sheet, /forgetLocalAccount\(\)/, "o‘chirilgandan keyin lokal sessiya tozalanmaydi");
});
