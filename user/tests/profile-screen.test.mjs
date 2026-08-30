import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Two screens must not draw the same noun two different ways.
 *
 * Profil counts presentations and J Tanga. Loyihalar makes presentations and
 * the home screen shows J Tanga, and both of those already have a drawing for
 * the thing — a slide stack cut from the icon sheet, and the coin. Reaching for
 * a generic Lucide `Presentation` or `Coins` on Profil is how an app ends up
 * with two coins: nothing fails, nothing looks broken in isolation, and the
 * product quietly stops being one product.
 *
 * So the rule is checked rather than remembered. The same two files that
 * Loyihalar and the wallet import have to be the two files Profil imports.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const PROFILE = "app/(app)/(tabs)/profile.tsx";

test("Taqdimot and J Tanga use the drawings the rest of the app already uses", () => {
  const profile = read(PROFILE);
  const projects = read("app/(app)/(tabs)/projects.tsx");

  const slideArt = /import\s+SlideCreateArt\s+from\s+"([^"]+)"/.exec(projects);
  assert.ok(slideArt, "Loyihalar taqdimot rasmini import qilmayapti — tekshiruv eskirgan");

  assert.match(
    profile,
    new RegExp(`import\\s+SlideCreateArt\\s+from\\s+"[^"]*${slideArt[1].split("/").pop()}"`),
    `Profil taqdimot uchun ${slideArt[1]} dan foydalanishi kerak`,
  );
  assert.match(
    profile,
    /import\s+coinIcon\s+from\s+"[^"]*assets\/coin\/coin-icon\.png"/,
    "Profil J Tanga uchun mavjud coin assetidan foydalanishi kerak",
  );

  // And the fallbacks they replaced must be gone, or both would render.
  for (const generic of ["Presentation", "Coins"]) {
    assert.ok(
      !new RegExp(`\\b${generic}\\b[^\\n]*from "lucide-react-native"`).test(profile)
        && !new RegExp(`Glyph:\\s*${generic}\\b`).test(profile),
      `Profil hali ham umumiy ${generic} ikonkasini import qilyapti`,
    );
  }
});

/**
 * The screen this replaced had eleven controls in one hue.
 *
 * Every icon was `colors.primary` at `strokeWidth={2}`, which is a list you
 * find your way around by counting rows rather than by looking. The fix was to
 * give each its own accent, and the way that regresses is not by someone
 * deleting the accents — it is by someone adding a twelfth row and copying the
 * old pattern for it. So the accents are counted, and they have to be distinct.
 */
test("every accent named by Profil exists, and the menu rows do not repeat one", () => {
  const profile = read(PROFILE);
  const tokens = read("src/theme/tokens.ts");

  const known = new Set(
    [...tokens.slice(tokens.indexOf("export const accents = {")).matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]),
  );
  assert.ok(known.size >= 5, `accents o‘qilmadi (${known.size})`);

  const used = [...profile.matchAll(/accent:\s*"(\w+)"/g)].map((match) => match[1]);
  assert.ok(used.length >= 8, `Profil accentlari topilmadi (${used.length})`);
  for (const accent of used) assert.ok(known.has(accent), `noma'lum accent: ${accent}`);

  // The five Sozlamalar rows, which are the block that used to be monochrome.
  const block = profile.slice(profile.indexOf("const SETTINGS = ["), profile.indexOf("] as const satisfies", profile.indexOf("const SETTINGS = [")));
  const menu = [...block.matchAll(/accent:\s*"(\w+)"/g)].map((match) => match[1]);
  assert.equal(menu.length, 5, "Sozlamalar qatorlari soni o‘zgargan");
  assert.equal(new Set(menu).size, 5, `menyu ikonkalari bir xil rangda: ${menu.join(", ")}`);
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

  assert.match(sheet, /BEKOR QILISH/, "bekor qilish tugmasi yo‘q");
  assert.match(sheet, /O‘CHIRISH/, "tasdiqlovchi tugma yozuvi yo‘q");
  assert.match(sheet, /forgetLocalAccount\(\)/, "o‘chirilgandan keyin lokal sessiya tozalanmaydi");
});
