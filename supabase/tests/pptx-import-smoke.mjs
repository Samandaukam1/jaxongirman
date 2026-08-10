/**
 * End-to-end check of PowerPoint import against a running local stack.
 *
 * The fixture is a real .pptx built here rather than a binary checked into the
 * repo: every part is written out in full, so when an assertion about geometry
 * or text fails it is obvious from this file what the input actually said.
 *
 * Entries are stored uncompressed. The reader accepts both, and STORED keeps
 * this script free of a deflate step whose only job would be to be undone.
 *
 * Requires: npx supabase start, and
 *   npx supabase functions serve --env-file supabase/functions/.env.test
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

function localEnvironment() {
  const output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  const values = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(?:"([^"]*)"|(.*))$/);
    if (match) values[match[1]] = match[2] ?? match[3];
  }
  return {
    url: values.API_URL,
    anonKey: values.ANON_KEY ?? values.PUBLISHABLE_KEY,
    serviceKey: values.SERVICE_ROLE_KEY ?? values.SECRET_KEY,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

/** Within a thousandth — the importer rounds coordinates to three places. */
function close(actual, expected, message) {
  assert(Math.abs(actual - expected) < 0.01, `${message} (${actual} ≈ ${expected})`);
}

/* ------------------------------------------------------------ the fixture */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP with every entry STORED. */
function zip(entries) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name);
    const checksum = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);

    const block = new Uint8Array(30 + nameBytes.length + data.length);
    block.set(new Uint8Array(local.buffer), 0);
    block.set(nameBytes, 30);
    block.set(data, 30 + nameBytes.length);
    locals.push(block);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);

    const centralBlock = new Uint8Array(46 + nameBytes.length);
    centralBlock.set(new Uint8Array(central.buffer), 0);
    centralBlock.set(nameBytes, 46);
    centrals.push(centralBlock);

    offset += block.length;
  }

  const centralSize = centrals.reduce((total, block) => total + block.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const output = new Uint8Array(total);
  let at = 0;
  for (const block of [...locals, ...centrals, new Uint8Array(end.buffer)]) {
    output.set(block, at);
    at += block.length;
  }
  return output;
}

const text = (value) => new TextEncoder().encode(value);

const SLIDE_WIDTH = 12192000;
const SLIDE_HEIGHT = 6858000;

const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="ppt" xmlns:r="rel">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/>
</p:presentation>`;

const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="rels">
  <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
</Relationships>`;

// The title is split across three runs with a lone space between them, which is
// exactly how PowerPoint writes a line whose formatting changes mid-sentence —
// and the case where a reader that trims whitespace loses a word boundary.
const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="ppt" xmlns:a="draw" xmlns:r="rel">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_WIDTH}" cy="1000000"/></a:xfrm></p:spPr>
        <p:txBody><a:p>
          <a:r><a:rPr sz="4000" b="1"/><a:t>Yillik</a:t></a:r>
          <a:r><a:rPr sz="4000" b="1"/><a:t> </a:t></a:r>
          <a:r><a:rPr sz="4000" b="1"/><a:t>hisobot</a:t></a:r>
        </a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:spPr><a:xfrm><a:off x="609600" y="2000000"/><a:ext cx="5000000" cy="2000000"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="1800"/><a:t>Birinchi &amp; asosiy</a:t></a:r></a:p>
          <a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="1800"/><a:t>Ikkinchi</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:pic>
        <p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
        <p:spPr><a:xfrm><a:off x="7000000" y="2000000"/><a:ext cx="4000000" cy="3000000"/></a:xfrm></p:spPr>
      </p:pic>
      <p:sp>
        <p:spPr><a:xfrm><a:off x="-2000000" y="-2000000"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>
          <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="rels">
  <Relationship Id="rId2" Type="image" Target="../media/image1.png"/>
  <Relationship Id="rId3" Type="notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`;

const notesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:p="ppt" xmlns:a="draw">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Ma'ruzachi uchun izoh.</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const pptx = zip([
  ["[Content_Types].xml", text('<?xml version="1.0"?><Types xmlns="ct"/>')],
  ["ppt/presentation.xml", text(presentationXml)],
  ["ppt/_rels/presentation.xml.rels", text(presentationRels)],
  ["ppt/slides/slide1.xml", text(slideXml)],
  ["ppt/slides/_rels/slide1.xml.rels", text(slideRels)],
  ["ppt/notesSlides/notesSlide1.xml", text(notesXml)],
  ["ppt/media/image1.png", new Uint8Array(PNG_1X1)],
]);

/* ----------------------------------------------------------------- the run */

const { url, anonKey, serviceKey } = localEnvironment();
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const email = `pptx-import-${randomUUID()}@example.test`;
const password = `${randomUUID()}Aa1!`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Test user was not created");
const userId = created.data.user.id;

try {
  const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  console.log("Uploading the deck…");
  const storagePath = `${userId}/imports/${randomUUID()}.pptx`;
  const uploaded = await user.storage.from("user-uploads").upload(storagePath, pptx, {
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  if (uploaded.error) throw uploaded.error;
  assert(true, "a .pptx is accepted by the upload bucket");

  console.log("Importing…");
  const imported = await user.functions.invoke("import-pptx", {
    body: { storagePath, sourceName: "Yillik hisobot.pptx" },
  });
  if (imported.error) {
    const detail = await imported.error.context?.text?.().catch(() => "");
    throw new Error(`import failed: ${imported.error.message} ${detail ?? ""}`);
  }

  const { presentationId, slideCount, elementCount, warnings } = imported.data;
  assert(slideCount === 1, "the deck's one slide came through");
  assert(Array.isArray(warnings) && warnings.length === 0, "nothing had to be reported as lossy");

  const presentation = await user.from("presentations").select("title,status,generated_slide_count").eq("id", presentationId).single();
  if (presentation.error) throw presentation.error;
  assert(presentation.data.status === "ready", "the import finished ready");
  assert(presentation.data.title === "Yillik hisobot", "the title placeholder named the deck, spaces intact");
  assert(presentation.data.generated_slide_count === 1, "the slide count was recorded");

  const slides = await user.from("slides").select("id,title,speaker_notes,background,position").eq("presentation_id", presentationId);
  if (slides.error) throw slides.error;
  const slide = slides.data[0];
  assert(slide.position === 0, "the slide kept its place in the deck");
  assert(slide.speaker_notes?.includes("Ma'ruzachi"), "the speaker notes came across");
  assert(slide.background?.color === "#ffffff", "the slide background colour came across");

  const elements = await user.from("slide_elements").select("*").eq("slide_id", slide.id).order("z_index");
  if (elements.error) throw elements.error;
  assert(elements.data.length === elementCount, "every element the importer reported was stored");

  const title = elements.data.find((element) => element.content?.text?.startsWith("Yillik"));
  assert(title.content.text === "Yillik hisobot", "runs split mid-sentence rejoin with their space");
  close(Number(title.x), 0, "the full-bleed title starts at the left edge");
  close(Number(title.width), 1000, "the full-bleed title spans the canvas");
  close(Number(title.height), 82.02, "EMU height maps onto the 562.5 canvas");
  // 40pt on a 13.333in slide is 40 × (1000 / 960) canvas units.
  close(Number(title.style.fontSize), 41.7, "point sizes scale with the slide, not with a guess");
  assert(title.style.fontWeight === "700", "bold came across");

  const bullets = elements.data.find((element) => element.content?.text?.includes("Birinchi"));
  assert(
    bullets.content.text === "• Birinchi & asosiy\n• Ikkinchi",
    "bulleted paragraphs keep their bullets, and entities are decoded",
  );

  const image = elements.data.find((element) => element.type === "image");
  assert(image.content.storageBucket === "presentation-assets", "the picture was re-homed into the assets bucket");
  close(Number(image.x), 574.147, "the picture landed where the file put it");

  const media = await service.storage.from("presentation-assets").download(image.content.storagePath);
  if (media.error) throw media.error;
  assert((await media.data.arrayBuffer()).byteLength === PNG_1X1.length, "the picture's bytes survived the round trip");

  // The red square sits entirely off the top-left corner; `slide_elements`
  // refuses a negative origin, so it must be dropped rather than clamped into
  // a visible artefact the user never drew.
  assert(
    !elements.data.some((element) => element.style?.fill === "#ff0000"),
    "a shape entirely off-slide is dropped, not folded onto the edge",
  );

  console.log("\nPPTX import smoke test passed.");
} finally {
  await service.auth.admin.deleteUser(userId);
  console.log("Disposable account removed.");
}
