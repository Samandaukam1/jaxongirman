import { attribute, descendants, integerAttribute, parseXml, path } from "./xml.ts";

/**
 * The pictures on a template slide, and which of them may be replaced.
 *
 * A deck built from a PowerPoint template keeps the original slide, so its
 * photographs are whatever the template shipped — the same stock cover on every
 * customer's deck about a different subject. Replacing one means swapping the
 * bytes of the media part the slide points at, which leaves the crop, the
 * frame, the shadow and every effect exactly as the designer set them. Editing
 * the XML instead would mean recreating all of that, badly.
 *
 * Pure: this reads two strings of markup and answers. The zip, the download and
 * the decision about what to put there belong to the caller.
 */

export type SlidePicture = {
  /** `<p:cNvPr id>` — stable within the slide, used for reporting. */
  shapeId: string;
  name: string;
  /** The relationship id the picture is embedded by. */
  embed: string;
  /** `ppt/media/image3.png`, resolved from the slide's own folder. */
  mediaPart: string;
  /** English Metric Units, as PowerPoint stores them. Zero when not stated. */
  width: number;
  height: number;
  /** Width over height, or 0 when the extent is missing. */
  aspect: number;
};

/** `../media/image1.png` seen from `ppt/slides/` is `ppt/media/image1.png`. */
function resolve(from: string, target: string): string {
  const base = from.slice(0, from.lastIndexOf("/"));
  const parts = `${base}/${target}`.split("/");
  const out: string[] = [];
  for (const piece of parts) {
    if (piece === "." || piece === "") continue;
    if (piece === "..") out.pop();
    else out.push(piece);
  }
  return out.join("/");
}

/** Relationship id → part, for one part's `.rels` file. */
export function relationshipTargets(part: string, relsMarkup: string): Map<string, string> {
  const targets = new Map<string, string>();
  let root;
  try {
    root = parseXml(relsMarkup);
  } catch {
    return targets;
  }

  for (const relationship of descendants(root, "Relationship")) {
    const id = attribute(relationship, "Id");
    const target = attribute(relationship, "Target");
    const mode = attribute(relationship, "TargetMode");
    // An external picture lives on somebody else's server. There are no bytes
    // in the package to replace, so it is not a slot this can fill.
    if (!id || !target || mode === "External") continue;
    targets.set(id, resolve(part, target));
  }
  return targets;
}

/**
 * Every picture on the slide, however the designer placed it.
 *
 * Two ways, and the second is the common one. `<p:pic>` is a picture object;
 * a shape with `<a:blipFill>` in its properties is a rectangle or a circle
 * painted with a photograph and cropped by its own outline, and that is how
 * most photography in a real template is placed. The importer next door learned
 * this the hard way — reading only `<p:pic>` meant an eleven-page deck imported
 * with no images at all — and reading only `<p:pic>` here would mean a template
 * whose pictures could never be replaced, for the same reason.
 */
export function readSlidePictures(slidePart: string, slideMarkup: string, relsMarkup: string): SlidePicture[] {
  const targets = relationshipTargets(slidePart, relsMarkup);
  let root;
  try {
    root = parseXml(slideMarkup);
  } catch {
    return [];
  }

  const pictures: SlidePicture[] = [];
  const take = (node: unknown, embed: string | null, properties: unknown) => {
    if (!embed) return;
    const mediaPart = targets.get(embed);
    if (!mediaPart || !/\/media\//.test(mediaPart)) return;
    if (pictures.some((seen) => seen.embed === embed && seen.mediaPart === mediaPart)) return;

    const extent = path(node as never, "spPr", "xfrm", "ext");
    const width = integerAttribute(extent, "cx") ?? 0;
    const height = integerAttribute(extent, "cy") ?? 0;

    pictures.push({
      shapeId: attribute(properties as never, "id") ?? "",
      name: attribute(properties as never, "name") ?? "",
      embed,
      mediaPart,
      width,
      height,
      aspect: width > 0 && height > 0 ? width / height : 0,
    });
  };

  for (const picture of descendants(root, "pic")) {
    take(picture, attribute(path(picture, "blipFill", "blip"), "embed"), path(picture, "nvPicPr", "cNvPr"));
  }
  for (const shape of descendants(root, "sp")) {
    take(shape, attribute(path(shape, "spPr", "blipFill", "blip"), "embed"), path(shape, "nvSpPr", "cNvPr"));
  }
  return pictures;
}

/**
 * One EMU is 1/914400 of an inch; a 16:9 slide is 12192000 wide.
 *
 * A picture smaller than a fifteenth of the slide's width is a logo, a badge,
 * an icon or a bullet ornament. Replacing one with a photograph of the topic is
 * how a deck ends up with a stock photo where the company mark was.
 */
const SLIDE_WIDTH_EMU = 12_192_000;
const SMALLEST_REPLACEABLE = SLIDE_WIDTH_EMU / 15;

/**
 * Which picture to offer the generator, and why the others were passed over.
 *
 * `shared` is the one that matters. Two slides can point at the same media
 * part, and replacing its bytes changes both — so a part used more than once in
 * the deck being built is left alone rather than quietly rewriting a page
 * nobody asked about. The caller supplies the tally because only it knows which
 * pages were chosen.
 */
export function replaceablePictures(
  pictures: readonly SlidePicture[],
  useCount: ReadonlyMap<string, number>,
): { usable: SlidePicture[]; skipped: { picture: SlidePicture; reason: string }[] } {
  const usable: SlidePicture[] = [];
  const skipped: { picture: SlidePicture; reason: string }[] = [];

  for (const picture of pictures) {
    if (picture.width > 0 && picture.width < SMALLEST_REPLACEABLE) {
      skipped.push({ picture, reason: "too_small" });
      continue;
    }
    if ((useCount.get(picture.mediaPart) ?? 0) > 1) {
      skipped.push({ picture, reason: "shared" });
      continue;
    }
    usable.push(picture);
  }

  // Biggest first: when a page has two, the one carrying the composition is the
  // one worth spending a search on.
  usable.sort((first, second) => (second.width * second.height) - (first.width * first.height));
  return { usable, skipped };
}

/**
 * What to ask a photo index for, given the hole the picture has to fill.
 *
 * Orientation comes from the shape rather than from a preference: a portrait
 * frame filled with a landscape photograph is a face cropped to its ear.
 */
export function orientationOf(picture: SlidePicture): "landscape" | "portrait" | "square" {
  if (picture.aspect === 0) return "landscape";
  if (picture.aspect > 1.2) return "landscape";
  if (picture.aspect < 0.85) return "portrait";
  return "square";
}
