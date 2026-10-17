import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { i18n } from "../i18n";

import { supabase } from "./supabase";
import { uploadLocalFile } from "./upload";

/**
 * The author's own pictures for a deck: picked here, shown on the slides.
 *
 * Each one is shrunk on the phone before it leaves it — the long side to 1600
 * px, JPEG — so a twelve-megapixel photograph becomes a couple of hundred
 * kilobytes, enough for a projector and nothing more. It goes straight into
 * the deck's own folder (`presentation-assets/<owner>/<deck>/source-N.jpg`),
 * the one place a phone may write there. There is no library: the picture
 * lives as long as the deck, and one the deck did not use is removed as soon
 * as the deck is built.
 */

export const MAX_SOURCE_IMAGES = 6;
const LONG_SIDE = 1600;
const BUCKET = "presentation-assets";

export type SourceImage = { uri: string; width: number; height: number; caption: string };

/** Photos from the library, as many as there is room for. */
export async function pickSourceImages(room: number): Promise<SourceImage[]> {
  if (room <= 0) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: room,
    quality: 1,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, room).map((asset) => ({ uri: asset.uri, width: asset.width, height: asset.height, caption: "" }));
}

/** The picture at projector size, as a JPEG file on the phone. */
async function shrink(image: SourceImage): Promise<string> {
  const context = ImageManipulator.manipulate(image.uri);
  const long = Math.max(image.width, image.height);
  if (long > LONG_SIDE) {
    context.resize(image.width >= image.height ? { width: LONG_SIDE } : { height: LONG_SIDE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.78, format: SaveFormat.JPEG });
  return saved.uri;
}

/** Where picture `index` (1–6) of a deck lives; the storage policy accepts nothing else. */
export function sourceImagePath(ownerId: string, presentationId: string, index: number): string {
  return `${ownerId}/${presentationId}/source-${index}.jpg`;
}

/**
 * Shrinks and uploads every picture, in order, and says where each went.
 * Throws with a sentence a person can read; what was uploaded before the
 * failure is taken back by the caller with `removeSourceImages`.
 */
export async function uploadSourceImages(
  ownerId: string,
  presentationId: string,
  images: readonly SourceImage[],
  uploaded: string[],
): Promise<{ path: string; caption: string }[]> {
  const placed: { path: string; caption: string }[] = [];
  for (const [position, image] of images.slice(0, MAX_SOURCE_IMAGES).entries()) {
    const path = sourceImagePath(ownerId, presentationId, position + 1);
    let file: string;
    try {
      file = await shrink(image);
    } catch {
      throw new Error(i18n.t("create:images.unreadable", { number: position + 1 }));
    }
    const outcome = await uploadLocalFile({ bucket: BUCKET, path, uri: file, contentType: "image/jpeg", maxBytes: 8 * 1024 * 1024 });
    if (!outcome.ok) throw new Error(i18n.t("create:images.failed", { number: position + 1 }));
    uploaded.push(path);
    placed.push({ path, caption: image.caption.replace(/\s+/g, " ").trim().slice(0, 300) });
  }
  return placed;
}

/** Takes back pictures uploaded for an order that then did not start. */
export async function removeSourceImages(paths: readonly string[]): Promise<void> {
  if (!paths.length) return;
  await supabase.storage.from(BUCKET).remove([...paths]);
}
