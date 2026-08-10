import assert from "node:assert/strict";
import { buildEdgeModules } from "../scripts/build-edge.mjs";

const WIDTH = 1000;
const HEIGHT = 562.5;
const LAYOUTS = ["cover", "agenda", "title_body", "two_columns", "statistic", "quote", "comparison", "timeline", "chart", "conclusion", "references"];

const dir = buildEdgeModules();
const { slideTemplates } = await import(`${dir}/templates/index.js`);
const { paletteFamilies } = await import(`${dir}/palettes.js`);
const { renderSlide } = await import(`${dir}/template-engine.js`);

const long = (word, times) => Array.from({ length: times }, () => word).join(" ");

/** Three content extremes every layout must survive without breaking. */
function contentCases(layout) {
  const base = { purpose: "Namuna", layout, visualPrompt: null };
  return [
    ["minimal", {
      ...base,
      title: "Qisqa",
      subtitle: null, body: null, bullets: [],
      quote: layout === "quote" ? { text: "Qisqa iqtibos.", attribution: "Muallif" } : null,
      statistic: layout === "statistic" ? { value: "7", label: "ta" } : null,
      chart: layout === "chart" ? { type: "bar", labels: ["A", "B"], values: [1, 2] } : null,
    }],
    ["typical", {
      ...base,
      title: "Alisher Navoiy hayoti va ijodiy merosi",
      subtitle: "Jaxongir AI tomonidan tayyorlangan taqdimot",
      body: "Mavzu aniq tuzilma va o'qilishi oson vizual iyerarxiya orqali yoritiladi.",
      bullets: ["Asosiy tushuncha va uning ahamiyati", "Muhim jihatlar o'rtasidagi bog'liqlik", "Amaliy xulosa va keyingi qadam"],
      quote: { text: "Odami ersang demagil odami, onikim yo'q xalq g'amidin g'ami.", attribution: "Alisher Navoiy" },
      statistic: { value: "68%", label: "auditoriya asosiy fikrni yaxshi eslab qoladi" },
      chart: { type: "donut", labels: ["Birinchi", "Ikkinchi", "Uchinchi"], values: [48, 32, 20] },
    }],
    ["overflow", {
      ...base,
      title: long("Juda uzun sarlavha bo'lagi", 9),
      subtitle: long("Uzun izohli qism", 12),
      body: long("Uzun matn bloki", 40),
      bullets: Array.from({ length: 6 }, (_, index) => `${index + 1}. ${long("juda uzun band matni", 14)}`),
      quote: { text: long("Uzun iqtibos matni", 22), attribution: long("Uzun muallif ismi", 6) },
      statistic: { value: "1 234 567 890", label: long("Juda uzun ko'rsatkich izohi", 14) },
      chart: { type: "line", labels: ["A", "B", "C", "D", "E", "F", "G", "H"], values: [5, 90, 12, 77, 33, 61, 8, 44] },
    }],
  ];
}

const sources = Array.from({ length: 14 }, (_, index) => `${index + 1}-manba: ${long("uzun manba nomi", 8)}`);
const hexPattern = /^#[0-9A-Fa-f]{6}$/;

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

let checked = 0;
const failures = [];

for (const template of slideTemplates) {
  for (const palette of paletteFamilies) {
    for (const layout of LAYOUTS) {
      for (const [caseName, semantic] of contentCases(layout)) {
        // The full palette matrix only needs one content case; layouts get all three.
        if (palette.code !== paletteFamilies[0].code && caseName !== "typical") continue;
        const label = `${template.code}/${layout}/${caseName}/${palette.code}`;
        const { background, elements } = renderSlide(template, palette, {
          presentationId: "00000000-0000-4000-8000-000000000001",
          ownerId: "00000000-0000-4000-8000-000000000002",
          slideId: "00000000-0000-4000-8000-000000000003",
          index: 3,
          total: 8,
          semantic,
          image: layout === "cover" || layout === "title_body" ? { bucket: "generated-images", path: "a/b.png" } : null,
          sources: layout === "references" ? sources : [],
        });
        checked += 1;

        if (!hexPattern.test(background)) failures.push(`${label}: fon rangi hex emas (${background})`);
        assert.ok(elements.length > 0, `${label}: bo'sh slayd`);

        const texts = [];
        for (const element of elements) {
          for (const [key, value] of Object.entries(element.style)) {
            if (typeof value !== "string" || !/color|fill|stroke/i.test(key)) continue;
            if (!hexPattern.test(value)) failures.push(`${label}: ${key} hal qilinmagan (${value})`);
          }
          assert.ok(element.width > 0 && element.height > 0, `${label}: nol o'lcham`);

          // Decor may bleed off-canvas by design, but must still touch it.
          if (element.type === "shape" || element.type === "icon") {
            const visible = overlapArea(element, { x: 0, y: 0, width: WIDTH, height: HEIGHT });
            if (visible <= 0) failures.push(`${label}: dekor kanvasdan butunlay tashqarida`);
            continue;
          }
          if (element.x < 0 || element.y < 0 || element.x + element.width > WIDTH + 0.5 || element.y + element.height > HEIGHT + 0.5) {
            failures.push(`${label}: ${element.type} chegaradan chiqdi (${Math.round(element.x)},${Math.round(element.y)} ${Math.round(element.width)}×${Math.round(element.height)})`);
          }
          if (element.type === "text") {
            if (Number(element.style.fontSize) < 12) failures.push(`${label}: shrift juda kichik (${element.style.fontSize})`);
            if (!String(element.content.text ?? "").trim()) failures.push(`${label}: bo'sh matn elementi`);
            texts.push(element);
          }
        }

        for (let first = 0; first < texts.length; first += 1) {
          for (let second = first + 1; second < texts.length; second += 1) {
            const a = texts[first];
            const b = texts[second];
            const smaller = Math.min(a.width * a.height, b.width * b.height);
            if (overlapArea(a, b) > smaller * 0.12) {
              failures.push(`${label}: matnlar ustma-ust (${String(a.content.text).slice(0, 20)}… / ${String(b.content.text).slice(0, 20)}…)`);
            }
          }
        }
      }
    }
  }
}

if (failures.length) {
  console.error(`\n${failures.length} ta muammo (${checked} holatdan):\n`);
  for (const failure of failures.slice(0, 60)) console.error("  ✗", failure);
  if (failures.length > 60) console.error(`  … va yana ${failures.length - 60} ta`);
  process.exit(1);
}

console.log(`✓ ${checked} ta render holati tekshirildi — chegara, ustma-ustlik, shrift va rang muammosi yo'q`);
