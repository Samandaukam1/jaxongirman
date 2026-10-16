#!/usr/bin/env node
/**
 * Looks at what the Liquid Glass engine makes, without generating a deck.
 *
 *   node supabase/scripts/glass-preview.mjs [outDir] [--seed=123] [--style=glass|editorial]
 *
 * Composes a sample deck under several art directions, paints the rows the way
 * the renderers do (absolute boxes, the same gradient and glass vocabulary)
 * and photographs each deck as one contact sheet with headless Chrome. Fonts
 * come from the library bucket, exactly the files the phone downloads.
 *
 * Reads the font catalogue from the linked project (read-only); writes nothing
 * anywhere but `outDir`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildEdgeModules, repoRoot } from "./build-edge.mjs";
import { contactSheet } from "./glass-paint.mjs";

const args = process.argv.slice(2);
const outDir = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? path.join(tmpdir(), "glass-preview"));
const seedArg = Number(args.find((arg) => arg.startsWith("--seed="))?.split("=")[1] ?? 0);
const style = args.find((arg) => arg.startsWith("--style="))?.split("=")[1] ?? "glass";
mkdirSync(outDir, { recursive: true });

const edge = buildEdgeModules();
const { buildDNA, candidateFaces, readArtDirection } = await import(`${edge}/glass/dna.js`);
const { composeDeck, pageFaults } = await import(`${edge}/glass/compose.js`);
const { readOutline, readSlide } = await import(`${edge}/glass/content.js`);

const supabaseUrl = readFileSync(path.join(repoRoot, "user/.env"), "utf8").match(/^EXPO_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim();

/* ------------------------------------------------------------ the fonts */

const families = candidateFaces().map((entry) => `'${entry.family.replace(/'/g, "''")}'`).join(",");
const raw = execFileSync("npx", ["supabase", "db", "query", "--linked",
  `select f.canonical_name n, f.normalized_name s, ff.weight w, ff.storage_path p from font_families f join font_faces ff on ff.family_id=f.id where not ff.italic and f.is_active and f.canonical_name in (${families})`,
], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const faces = JSON.parse(raw.slice(raw.indexOf("{"))).rows;
const byKey = new Map(faces.map((face) => [`${face.n}|${face.w}`, face]));
const available = (family, weight) => byKey.has(`${family}|${weight}`);
const face = (pick) => {
  const found = byKey.get(`${pick.family}|${pick.weight}`);
  if (!found) return { fontFamily: pick.weight >= 600 ? "Manrope_700Bold" : "Manrope_400Regular", fontWeight: String(pick.weight) };
  return { fontFamily: `jx_${found.s}_${found.w}`, fontFallback: pick.weight >= 600 ? "Manrope_700Bold" : "Manrope_400Regular", fontAsset: found.p, fontDisplayName: found.n, fontWeight: String(pick.weight) };
};

/* ----------------------------------------------------------- the sample */

const topic = "Sun’iy intellektning ta’limdagi o‘rni va istiqbollari";
const outline = readOutline({
  shortTitle: "AI va ta’lim",
  subtitle: "Raqamli davrda o‘qituvchi, talaba va algoritm o‘rtasidagi yangi muvozanat",
  coverQuery: "students artificial intelligence classroom",
  slides: [
    { title: "Sun’iy intellekt nima va u ta’limga qanday kirib keldi", kind: "statement", focus: "AI tushunchasi", imageQuery: null },
    { title: "AI ta’limda bajaradigan to‘rt asosiy vazifa", kind: "cards", focus: "vazifalar", imageQuery: null },
    { title: "Raqamlarda: AI ta’lim bozori", kind: "stats", focus: "statistika", imageQuery: null },
    { title: "Shaxsiylashtirilgan ta’lim qanday ishlaydi", kind: "process", focus: "jarayon", imageQuery: null },
    { title: "Sinfxonadagi raqamli yordamchilar", kind: "photo", focus: "amaliyot", imageQuery: "teacher tablet classroom" },
    { title: "An’anaviy va AI asosidagi ta’lim", kind: "comparison", focus: "taqqoslash", imageQuery: null },
    { title: "Rivojlanish bosqichlari", kind: "timeline", focus: "tarix", imageQuery: null },
    { title: "O‘quvchilar AI vositalaridan qanchalik foydalanadi", kind: "chart", focus: "diagramma", imageQuery: null },
    { title: "Kelajak haqida", kind: "quote", focus: "iqtibos", imageQuery: null },
    { title: "Xavflar va axloqiy masalalar", kind: "bullets", focus: "xavflar", imageQuery: null },
  ],
}, { topic, count: 10 });

const copy = [
  { eyebrow: "Tushuncha", title: outline.slides[0].title, lead: "Sun’iy intellekt — inson tafakkuriga xos vazifalarni bajaradigan algoritmlar majmui bo‘lib, bugun u darsni rejalashtirishdan tortib baholashgacha bo‘lgan har bir bosqichga kirib kelmoqda.", points: [{ title: "2016", text: "Ta’lim platformalarida tavsiya tizimlari keng tarqaldi" }, { title: "2023", text: "Generativ modellar sinfxonaga kirdi" }] },
  { eyebrow: "Vazifalar", title: outline.slides[1].title, lead: "AI o‘qituvchining o‘rnini bosmaydi — u vaqtni tejaydi va har bir o‘quvchiga moslashadi.", points: [{ title: "Moslashuv", text: "Har bir o‘quvchining sur’atiga qarab topshiriqlarni tanlaydi." }, { title: "Baholash", text: "Test va yozma ishlarni bir necha soniyada tekshiradi." }, { title: "Tahlil", text: "O‘zlashtirishdagi bo‘shliqlarni erta aniqlaydi." }, { title: "Kontent", text: "Mavzuga oid misollar va mashqlarni avtomatik yaratadi." }] },
  { eyebrow: "Statistika", title: outline.slides[2].title, lead: "Bozor besh yilda deyarli olti barobar o‘sishi kutilmoqda.", stats: [{ value: "$6,1 mlrd", label: "2024-yilda ta’limdagi AI bozori hajmi" }, { value: "36%", label: "yillik o‘rtacha o‘sish sur’ati" }, { value: "86%", label: "talabalar AI vositalaridan foydalanadi" }] },
  { eyebrow: "Jarayon", title: outline.slides[3].title, lead: "Tizim har bir javobdan o‘rganadi va keyingi qadamni tanlaydi.", points: [{ title: "Diagnostika", text: "Boshlang‘ich bilim darajasi aniqlanadi." }, { title: "Yo‘nalish", text: "Shaxsiy o‘quv yo‘li tuziladi." }, { title: "Mashq", text: "Moslashtirilgan topshiriqlar beriladi." }, { title: "Qayta aloqa", text: "Natija tahlil qilinib, reja yangilanadi." }] },
  { eyebrow: "Amaliyot", title: outline.slides[4].title, lead: "O‘zbekiston maktablarida ham raqamli yordamchilar sinovdan o‘tkazilmoqda.", points: [{ title: "Chatbotlar", text: "Savollarga kun-u tun javob beradi." }, { title: "Tarjimon", text: "Xorijiy manbalarni ona tilida ochadi." }, { title: "Tahlilchi", text: "O‘qituvchiga sinf holati haqida hisobot beradi." }] },
  { eyebrow: "Taqqoslash", title: outline.slides[5].title, lead: "Eng yaxshi natija ikkala yondashuv uyg‘unlashganda erishiladi.", left: { heading: "An’anaviy", points: ["Hammaga bir xil sur’at", "Baholash ko‘p vaqt oladi", "Qayta aloqa kechikadi"] }, right: { heading: "AI asosidagi", points: ["Har kimga o‘z sur’ati", "Bir zumda tekshiruv", "Doimiy shaxsiy tavsiya"] } },
  { eyebrow: "Tarix", title: outline.slides[6].title, lead: "", points: [{ title: "1960", text: "Birinchi dasturlashtirilgan o‘qitish tizimi PLATO" }, { title: "1990", text: "Intellektual repetitor tizimlari paydo bo‘ldi" }, { title: "2012", text: "Ommaviy onlayn kurslar va katta ma’lumotlar davri" }, { title: "2023", text: "Generativ AI sinfxonalarga kirib keldi" }] },
  { eyebrow: "Diagramma", title: outline.slides[7].title, lead: "So‘rovnoma 2024-yilda 3 800 talaba orasida o‘tkazilgan.", chart: { labels: ["Har kuni", "Haftada", "Oyda", "Hech qachon"], values: [24, 54, 8, 14], unit: "%", insight: "Talabalarning to‘rtdan uch qismi AI vositalaridan kamida haftada bir marta foydalanadi." } },
  { eyebrow: "Iqtibos", title: outline.slides[8].title, lead: "", quote: { text: "Texnologiya — bu faqat vosita. Bolalarni birga ishlashga va o‘rganishga undashda eng muhim rolni o‘qituvchi o‘ynaydi.", author: "Bill Geyts" } },
  { eyebrow: "Xavflar", title: outline.slides[9].title, lead: "Har qanday kuchli vosita kabi, AI ham mas’uliyat talab qiladi.", points: [{ title: "Plagiat", text: "Mustaqil fikrlash o‘rnini tayyor javob egallashi mumkin." }, { title: "Shaxsiy ma’lumot", text: "O‘quvchilar haqidagi ma’lumotlar himoyalanishi shart." }, { title: "Xatolar", text: "Model ishonchli ko‘rinadigan noto‘g‘ri javob berishi mumkin." }, { title: "Tengsizlik", text: "Texnologiyaga ega bo‘lmaganlar ortda qolishi mumkin." }] },
];
const slides = copy.map((entry, index) => readSlide({ points: [], stats: [], quote: null, chart: null, left: null, right: null, ...entry }, outline.slides[index]));

const picture = (seed) => ({ url: `https://picsum.photos/seed/${seed}/900/1000` });
const pictures = new Map([["teacher tablet classroom", picture("classroom")]]);

const directions = [
  { mode: "dark", hue: 268, mood: "cosmic", typography: "serif", energy: "vivid" },
  { mode: "light", hue: 24, mood: "warm", typography: "mixed", energy: "vivid" },
  { mode: "dark", hue: 190, mood: "tech", typography: "sans", energy: "vivid" },
  { mode: "light", hue: 160, mood: "fresh", typography: "sans", energy: "calm" },
  { mode: "light", hue: 35, mood: "classic", typography: "serif", energy: "calm" },
  { mode: "dark", hue: 45, mood: "elegant", typography: "serif", energy: "calm" },
];

let allFaults = 0;
directions.forEach((raw, index) => {
  const direction = readArtDirection(raw, topic);
  const seed = (seedArg || 1000) + index * 7;
  const dna = buildDNA({ direction, seed, available, style });
  const deck = composeDeck({
    dna, face, topic, shortTitle: outline.shortTitle, subtitle: outline.subtitle,
    author: "Jaxongir Qurbonnazarov", teacher: "D. Karimova", year: 2026,
    slides, sources: ["UNESCO. AI and the Future of Education, 2023", "OECD Digital Education Outlook 2023", "HolonIQ: Education AI market, 2024", "O‘zbekiston Respublikasi Raqamli texnologiyalar vazirligi, 2024"],
    cover: picture(`cover${index}`), pictures,
  });
  for (const [at, slide] of deck.entries()) {
    const faults = pageFaults(slide.rows);
    if (faults.length) { allFaults += faults.length; console.log(`  ${direction.mood}/${at + 1} ${slide.layout}: ${faults.join(", ")}`); }
  }
  const caption = `${dna.style}${dna.style === "editorial" ? ` (${dna.panelLook})` : ""} · ${direction.mode} · ${direction.mood} · ${direction.typography} · hue ${dna.direction.hue} · ${dna.fonts.display.family} + ${dna.fonts.body.family}`;
  contactSheet({ deck, caption, outDir, name: `${style}-${index}`, supabaseUrl });
  console.log(`${style}-${index}.png  ${direction.mode}/${direction.mood}  ${dna.fonts.display.family} + ${dna.fonts.body.family}`);
});
console.log(allFaults ? `${allFaults} ta nuqson` : "nuqson yo‘q");
