import {
  ANCHORS,
  ARCHETYPE_PURPOSES,
  BINDINGS,
  BORDER_STYLES,
  CANVAS_HEIGHT,
  CANVAS_LABEL,
  CANVAS_WIDTH,
  CHART_KINDS,
  COLOR_ROLES,
  CONDITIONS,
  ELEMENT_TYPES,
  FONT_FORMATS,
  FONT_ROLES,
  GRADIENT_TYPES,
  IMAGE_FITS,
  IMAGE_ORIENTATIONS,
  IMAGE_QUERY_SOURCES,
  IMAGE_SOURCE_STRATEGIES,
  JSLAYD_HEADER,
  LIMITS,
  MIN_READABLE_FONT_SIZE,
  OVERFLOW_MODES,
  REQUIRED_COLOR_ROLES,
  SHAPE_KINDS,
  TEXT_ALIGNMENTS,
  TEXT_EFFECTS,
  TEXT_TRANSFORMS,
  TIERS,
  TIER_LABELS,
  VERTICAL_ALIGNMENTS,
} from "./spec.ts";

/**
 * The JSLAYD Design Prompt Specification, as the admin copies it (§88).
 *
 * Every list in it is generated from `spec.ts` rather than typed out, so the
 * document an admin hands to an AI can never describe a language the compiler
 * does not implement. Adding a property to the spec updates the standard in the
 * same commit, by construction.
 */

const list = (values: readonly string[]) => values.join(", ");
const bullets = (values: readonly string[]) => values.map((value) => `  - ${value}`).join("\n");

/** The instruction block from §89 — copyable on its own. */
export const AI_INSTRUCTION = `Sizga berilgan dizayn tavsifini faqat JSLAYD Design Prompt 1.0
standartidagi buyruqlarga aylantiring.
Standartda mavjud bo'lmagan property o'ylab topmang.
Dizaynning:
rang,
font,
o'lcham,
koordinata,
rotation,
shadow,
gradient,
image slot,
chart,
table,
spacing,
element hierarchy
xususiyatlarini aniq yozing.
Noaniq qiymatlarni imkon qadar dizayn tizimi doirasida
deterministik qilib belgilang.
Natijada faqat valid JSLAYD Design Prompt qaytaring.`;

/** A complete, compilable design — the "namuna prompt" button copies this. */
export const SAMPLE_PROMPT = `${JSLAYD_HEADER}

# Namuna dizayn. Har bir bo'lim va element turini ko'rsatadi.

[DESIGN]
name: Apelsen Futuristik
slug: apelsen-futuristik
tier: super_professional
description: Kesilgan doiralar, ulkan raqamlar va issiq gradientlar
canvas: ${CANVAS_LABEL}
premium: true

[COLOR_FAMILY]
background: #FFFFFF
surface: #F7F4F0
primary: #FF6A00
secondary: #FFD166
accent: #FF6A00
text: #111111
muted: #6B6B6B

[CHART_PALETTE]
colors: #FF6A00, #111111, #FFD166, #6C63FF

[FONTS]
font_1:
  name: Apelsen Display
  role: display, heading
  asset: apelsen-display.ttf
  fallback: League Spartan
  weight: 800
font_2:
  name: Apelsen Text
  role: body, caption, subheading
  asset: apelsen-text.ttf
  fallback: Manrope
  weight: 400

[GLOBAL]
margin: 120
titleFont: font_1
bodyFont: font_2
accentFont: font_1
headingColor: text
textColor: muted
imageStrategy: internet_search
showLabels: true
showGrid: false

[VISUAL_DNA]
rotationRange: -6..6
cornerRadiusFamily: 0, 24, 48, 999
spacingScale: 24, 48, 72, 120
titleScale: 72..168
bodyScale: 24..40
imageTreatment: photo
decorationDensity: medium
shadowFamily: 0 24 64 0 0.18 text

[SLIDE cover_01]
purpose: cover
background: background
priority: 90
supportsImage: true

[ELEMENT halo]
type: decorative
shape: circle
x: 1380
y: -140
width: 680
height: 680
gradient:
  type: linear
  angle: 135
  stops:
    0: #FF7100
    50: #FFB000
    100: #FFE86A
opacity: 0.9
zIndex: 1

[ELEMENT eyebrow]
type: text
text: JAXONGIR AI
x: 120
y: 132
width: 600
height: 44
font: font_2
fontSize: 26
fontWeight: 600
letterSpacing: 6
textTransform: uppercase
color: muted
maxLines: 1
minFontSize: 24
zIndex: 5

[ELEMENT title]
type: text
bind: {{title}}
x: 120
y: 300
width: 1100
height: 400
font: font_1
fontSize: 148
fontWeight: 800
lineHeight: 0.98
color: text
rotation: -4
maxLines: 3
minFontSize: 72
overflow: shrink
zIndex: 5

[ELEMENT subtitle]
type: text
bind: {{subtitle}}
when: hasSubtitle
x: 124
y: 740
width: 820
height: 120
font: font_2
fontSize: 34
color: muted
maxLines: 2
zIndex: 5

[ELEMENT hero]
type: image
slot: hero_image
bind: {{image_1}}
sourceStrategy: internet_search
queryFrom: slide_title, keywords
orientation: landscape
stylePreference: documentary
x: 1180
y: 180
width: 620
height: 720
fit: cover
rotation: 5
borderRadius: 48
shadow: 0 32 72 0 0.22 text
zIndex: 3

[SLIDE statistics_01]
purpose: statistics
background: background
priority: 70

[ELEMENT heading]
type: text
bind: {{title}}
x: 120
y: 120
width: 1100
height: 180
font: font_1
fontSize: 88
fontWeight: 800
color: text
maxLines: 2
zIndex: 5

[ELEMENT figure]
type: stat
value: {{stat_value}}
label: {{stat_label}}
suffix: +
x: 120
y: 360
width: 780
height: 420
valueFont: font_1
valueFontSize: 240
valueFontWeight: 800
valueColor: text
labelFont: font_2
labelFontSize: 32
labelColor: muted
spacing: 24
zIndex: 5

[ELEMENT breakdown]
type: chart
chart: doughnut
bind: {{chart_data}}
x: 1060
y: 340
width: 700
height: 460
labelColor: muted
showLabels: true
showValues: false
cornerRadius: 8
strokeWidth: 44
zIndex: 4

[SLIDE table_01]
purpose: table
background: surface
priority: 60

[ELEMENT heading]
type: text
bind: {{title}}
x: 120
y: 110
width: 1680
height: 140
font: font_1
fontSize: 76
fontWeight: 800
color: text
maxLines: 2
zIndex: 5

[ELEMENT grid]
type: table
bind: {{table_data}}
x: 120
y: 300
width: 1680
height: 640
columns: 4
rows: 6
header: true
headerBackground: primary
headerColor: textOnPrimary
headerFont: font_1
headerSize: 30
cellFont: font_2
cellSize: 28
cellColor: text
cellAltBackground: background
padding: 18
borderWidth: 1
borderColor: border
borderRadius: 24
zIndex: 4

[SLIDE conclusion_01]
purpose: conclusion
background: text
priority: 80

[ELEMENT closing]
type: text
bind: {{title}}
x: 200
y: 380
width: 1520
height: 320
font: font_1
fontSize: 120
fontWeight: 800
lineHeight: 1.02
color: background
align: center
maxLines: 3
minFontSize: 64
zIndex: 5

[ELEMENT rule]
type: divider
shape: line
x: 860
y: 760
width: 200
height: 8
fill: accent
thickness: 8
zIndex: 4
`;

/** The full specification (§88), assembled from the compiler's own vocabulary. */
export const PROMPT_STANDARD = `JSLAYD DESIGN PROMPT SPECIFICATION 1.0
=======================================

JSLAYD — JAXONGIRMAN'ning universal taqdimot dizayn tili.
Bu hujjat prompt sintaksisini to'liq belgilaydi. Standartda yo'q buyruq
kompilyatorda ERROR beradi va hech qachon jimgina e'tiborsiz qoldirilmaydi.

1. UMUMIY QOIDALAR
------------------
- Birinchi qator aynan: ${JSLAYD_HEADER}
- Har bir qator: \`kalit: qiymat\` yoki \`[BO'LIM]\`.
- \`#\` bilan BOSHLANGAN butun qator izoh. Qator oxirida izoh yozib bo'lmaydi,
  chunki u rang qiymatidan (\`color: #FF6A00\`) farqlanmaydi.
- Chekinish faqat probel bilan; tabulyatsiya taqiqlangan.
- Qiymati bo'sh kalitdan keyin chekintirilgan qatorlar uning ichki bloki bo'ladi.
- Kanonik kanvas: ${CANVAS_WIDTH}×${CANVAS_HEIGHT} (16:9). Boshi (0,0) — yuqori chap burchak.
- Barcha koordinata va o'lchamlar shu kanvas birligida. Renderer o'zi masshtablaydi.

2. BO'LIMLAR
------------
[DESIGN]         majburiy   dizayn pasporti
[COLOR_FAMILY]   majburiy   rang rollari
[CHART_PALETTE]  ixtiyoriy  diagramma ranglari
[FONTS]          majburiy   1–${LIMITS.fonts} ta shrift
[GLOBAL]         ixtiyoriy  standart qiymatlar
[VISUAL_DNA]     ixtiyoriy  dizayn chegaralari
[SLIDE <id>]     majburiy   slayd arxetipi (kamida bitta)
[ELEMENT <id>]   —          o'zidan oldingi [SLIDE] elementi

3. [DESIGN]
-----------
name         majburiy   ko'rinadigan nom
slug         majburiy   kichik harf va chiziqcha: apelsen-futuristik
tier         majburiy   ${list(TIERS)}
                        (${TIERS.map((tier) => `${tier} = ${TIER_LABELS[tier]}`).join(", ")})
description  ixtiyoriy  qisqa tavsif
canvas       ixtiyoriy  faqat ${CANVAS_LABEL}
premium      ixtiyoriy  true / false

4. [COLOR_FAMILY]
-----------------
Rollar: ${list(COLOR_ROLES)}
Majburiy: ${list(REQUIRED_COLOR_ROLES)}
Qolganlari avtomatik hisoblanadi (kontrast bo'yicha) va INFO sifatida ko'rsatiladi.
Qiymat faqat aniq rang: #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb(), rgba().
Rang oilasida rol nomiga ishora qilish mumkin emas.

Bir dizayn bir nechta rang oilasini tashishi mumkin (chegara ${LIMITS.colorFamilies} ta):

  [COLOR_FAMILY]            # birinchisi — standart oila
  name: Limon va tun
  background: #F4F4F2
  ...

  [COLOR_FAMILY kobalt]     # foydalanuvchi tanlay oladigan qo'shimcha oila
  name: Kobalt va qahrabo
  background: #F5F7FF
  ...

Oila o'z diagramma ranglarini ham olib yura oladi:

  chartPalette: #1B4DE4, #FFB020, #7FA0F5, #0B1B44

Yozilmasa, oila [CHART_PALETTE] dagi umumiy palitrani oladi.

Har bir oila AYNI rol to'plamini to'ldiradi. Aynan shu bir xillik tufayli
bitta dizayn sakkizta ko'rinishda chiqa oladi va biror element hech qachon
aniq rang yozmaydi. Oila faqat bo'yoqni almashtiradi — joylashuvni emas.

5. [CHART_PALETTE]
------------------
colors: #FF6A00, #111111, #FFD166, #6C63FF
Ma'lumot palitradan ko'p bo'lsa, ranglar deterministik ravishda kengaytiriladi
(fonga qarab yoritiladi yoki qoraytiriladi). Tasodifiy rang yo'q.

6. [FONTS]
----------
Har bir shrift \`font_1:\` … \`font_4:\` marker bilan boshlanadi. \`font_1\` majburiy.
Xossalar markerdan keyin yoki chekintirilgan holda yozilishi mumkin.

name      ixtiyoriy  ko'rinadigan nom
role      majburiy   ${list(FONT_ROLES)}  (vergul bilan bir nechta)
asset     ixtiyoriy  yuklangan fayl nomi, masalan apelsen-display.ttf
                     yo'l ajratuvchi (/ \\ ..) taqiqlangan
format    ixtiyoriy  ${list(FONT_FORMATS)}
weight    ixtiyoriy  100–900
italic    ixtiyoriy  true / false
fallback  ixtiyoriy  ilova bilan keladigan shrift: Manrope, League Spartan,
                     Arimo, Pinyon Script, Inter, Caveat Brush

Eslatma: WOFF2 qo'llab-quvvatlanmaydi — PDF eksporti uni joylay olmaydi.
PPTX eksportida maxsus shrift ochuvchining kompyuterida almashtirilishi mumkin;
bu haqda kompilyator ogohlantiradi va shriftni jimgina almashtirmaydi.

7. [GLOBAL]
-----------
margin, titleFont, bodyFont, accentFont, headingColor, textColor, imageStrategy,
showLegend, showLabels, showValues, showGrid, showAxis,
chartCornerRadius, chartGap, chartStrokeWidth.
Elementlar bu qiymatlarni meros qilib oladi va ularni bekor qila oladi.

8. [VISUAL_DNA]
---------------
rotationRange        -6..6
cornerRadiusFamily   0, 24, 48
shadowFamily         soya (quyida 12-bo'limga qarang)
spacingScale         24, 48, 72
titleScale           72..168
bodyScale            24..40
imageTreatment       photo, illustration, render3d, abstract, mixed
decorationDensity    none, low, medium, high

Generator matnni sig'dirish uchun kichik moslashtirish qilishi mumkin, lekin
shu chegaralardan chiqmaydi. Bo'lim yozilmasa, chegaralar dizaynning o'zidan
o'lchab olinadi.

cornerRadiusFamily, shadowFamily va spacingScale uchun \`none\` deb yozish
mumkin: bu "bu dizaynda bunday oila yo'q" degani. Qatorni umuman yozmaslik
esa "o'zing o'lchab ol" degani — bu ikkisi bir xil emas.

9. [SLIDE <id>]
---------------
id                 kichik harf, raqam, pastki chiziq: text_image_02
purpose            ${list(ARCHETYPE_PURPOSES)}
background         rang roli yoki aniq rang
backgroundGradient gradient (12-bo'lim)
minText / maxText  belgilar soni oralig'i
priority           0–100, mos arxetiplar orasidan tanlash uchun
supportsImage / supportsChart / supportsTable / supportsStats / supportsQuote
                   ko'rsatilmasa, elementlardan avtomatik aniqlanadi

Bir purpose uchun bir nechta arxetip bo'lishi mumkin (text_image_01,
text_image_02, …). Generator taqdimot davomida ularni almashtirib turadi.

10. [ELEMENT <id>] — umumiy xossalar
------------------------------------
type      majburiy  ${list(ELEMENT_TYPES)}
x, y      majburiy  koordinata
width     majburiy
height    majburiy
anchor    ixtiyoriy ${list(ANCHORS)}  (standart: top-left)
rotation  ixtiyoriy -360..360, manfiy ham mumkin: rotation: -6
zIndex    ixtiyoriy butun son, katta qiymat tepada
opacity   ixtiyoriy 0..1
when      ixtiyoriy ${list(CONDITIONS)}
parent    ixtiyoriy \`type: group\` elementning id'si

11. MATN ELEMENTLARI (text, quote, number, badge, list)
-------------------------------------------------------
bind / text     bittasi majburiy — bog'lanish yoki aniq matn
font            font_1… yoki rol nomi (${list(FONT_ROLES)})
fontSize        majburiy
fontWeight      100–900
fontStyle       normal, italic
letterSpacing   son
lineHeight      0.6–4 (font o'lchamiga nisbatan)
align           ${list(TEXT_ALIGNMENTS)}
verticalAlign   ${list(VERTICAL_ALIGNMENTS)}
textTransform   ${list(TEXT_TRANSFORMS)}
color           rang
maxLines        butun son
overflow        ${list(OVERFLOW_MODES)}
minFontSize     kichrayish chegarasi (tavsiya: ${MIN_READABLE_FONT_SIZE} dan kichik emas)
padding         matn atrofidagi ichki bo'shliq
background / backgroundGradient   matn ortidagi plastinka
borderRadius / border*            (13, 14-bo'limlar)

list qo'shimcha: marker (bullet, number, dash, none), markerColor,
maxItems, itemSpacing.

12. EFFEKTLAR VA SOYA
---------------------
effect: ${list(TEXT_EFFECTS)}
Har bir effekt o'z qiymatini talab qiladi, aks holda WARNING beriladi:
  stroke / outline  →  strokeWidth, strokeColor
  highlight         →  highlight
  gradientText      →  gradientText (gradient bloki)
  shadow            →  shadow
  blur              →  blur

Soya ikki ko'rinishda yoziladi:
  shadow: 0 24 64 0 0.18 text          # offsetX offsetY blur spread opacity color
  shadow:
    offsetX: 0
    offsetY: 24
    blur: 64
    spread: 0
    opacity: 0.18
    color: text
Bir nechta soya uchun \`shadow:\` qatorini takrorlang (chegara ${LIMITS.shadows} ta).
\`shadow: none\` soyani o'chiradi.

13. GRADIENT
------------
Turlari: ${list(GRADIENT_TYPES)}. Stop soni 2 dan ${LIMITS.gradientStops} tagacha.
  gradient: linear 135 #FF7100 #FFB000 #FFE86A
yoki
  gradient:
    type: linear
    angle: 135
    stops:
      0: #FF7100
      50: #FFB000
      100: #FFE86A

14. BURCHAK VA CHEGARA
----------------------
borderRadius        bitta son yoki to'rtta son (soat yo'nalishi bo'yicha)
topLeftRadius / topRightRadius / bottomRightRadius / bottomLeftRadius
borderWidth         majburiy, aks holda chegara chizilmaydi
borderColor
borderStyle         ${list(BORDER_STYLES)}
borderOpacity       0..1

15. RASM (image, frame)
-----------------------
slot             semantik nom: hero_image
bind             {{image_1}} / {{image_2}} / {{image_3}}
sourceStrategy   ${list(IMAGE_SOURCE_STRATEGIES)}
imageRequired    true / false
queryFrom        ${list(IMAGE_QUERY_SOURCES)}
orientation      ${list(IMAGE_ORIENTATIONS)}
stylePreference  erkin matn, masalan: documentary
fit              ${list(IMAGE_FITS)}
focusX / focusY  0..1 — kesish markazi
overlay / overlayGradient / overlayOpacity
borderRadius, border*, shadow

Prompt rasmning o'zini emas, faqat SLOT va MANBA STRATEGIYASINI belgilaydi.
Haqiqiy rasm taqdimot yaratilayotganda joylashtiriladi.

16. SHAKL (shape, decorative, divider, line)
--------------------------------------------
shape       ${list(SHAPE_KINDS)}
fill        rang
gradient    gradient bloki
sides       faqat polygon uchun, 3–24
thickness   line va divider uchun
borderRadius, border*, shadow

17. IKONKA
----------
icon         Lucide nomi, PascalCase: ArrowRight
color
strokeWidth  0.5–8

18. DIAGRAMMA
-------------
chart         ${list(CHART_KINDS)}
bind          {{chart_data}}
chartPalette  ushbu diagramma uchun ranglar
labelColor, axisColor, font, labelSize
showLegend, showLabels, showValues, showGrid, showAxis
cornerRadius, gap, strokeWidth

Ma'lumot dinamik: labels va values o'zgarsa, diagramma qayta hisoblanadi.
Tayyor SVG yoki rasm ishlatilmaydi.

19. JADVAL
----------
bind             {{table_data}}
columns          1–${LIMITS.tableColumns}
rows             1–${LIMITS.tableRows}
header           true / false
headerBackground, headerColor, headerFont, headerSize
cellBackground, cellAltBackground, cellColor, cellFont, cellSize
padding, align, columnWidths, border*, borderRadius

Kompilyator jadval balandligi qatorlarga yetishini tekshiradi va yetmasa
ogohlantiradi.

20. STATISTIKA
--------------
value        {{stat_value}} yoki aniq matn
label        {{stat_label}}
prefix / suffix
value* xossalari: valueFont, valueFontSize, valueFontWeight, valueColor, …
label* xossalari: labelFont, labelFontSize, labelColor, …
spacing, padding, background, borderRadius, border*, shadow

21. GURUH
---------
\`type: group\` element quti hosil qiladi. Boshqa elementlar \`parent: <group_id>\`
orqali unga qo'shiladi. Guruh o'zidan oldin e'lon qilinishi shart.

22. MA'LUMOT BOG'LANISHLARI
---------------------------
Faqat quyidagi nomlar ishlaydi:
${bullets(BINDINGS.map((binding) => `{{${binding}}}`))}

Bog'lanish — bu ma'lumot, kod emas. Ifoda, funksiya chaqiruvi, xossaga murojaat
va boshqa hech qanday sintaksis qo'llab-quvvatlanmaydi.

23. TEKSHIRUV DARAJALARI
------------------------
ERROR    — kompilyatsiya bo'lmaydi
WARNING  — kompilyatsiya bo'ladi, lekin natija kutilganidan farq qilishi mumkin
INFO     — maslahat

Noma'lum bo'lim, noma'lum buyruq, noma'lum qiymat va noma'lum bog'lanish
har doim ERROR beradi. Kompilyator hech narsani taxmin qilmaydi.

24. CHEGARALAR
--------------
Prompt hajmi            ${Math.round(LIMITS.sourceBytes / 1024)} KB
Arxetiplar              ${LIMITS.archetypes} ta
Bir arxetipdagi element ${LIMITS.elementsPerArchetype} ta
Jami element            ${LIMITS.elementsPerDocument} ta
Shriftlar               ${LIMITS.fonts} ta
Gradient stoplari       ${LIMITS.gradientStops} ta
Soyalar                 ${LIMITS.shadows} ta

25. AI UCHUN KO'RSATMA
----------------------
${AI_INSTRUCTION}
`;

/** Everything the admin's "standartni ochish" drawer shows. */
export const STANDARD_DOCUMENT = {
  version: "1.0",
  title: "JSLAYD Prompt standarti",
  specification: PROMPT_STANDARD,
  instruction: AI_INSTRUCTION,
  sample: SAMPLE_PROMPT,
} as const;
