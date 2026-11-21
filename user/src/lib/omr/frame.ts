import type { CameraView } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** One small camera frame, held only in memory: the JPEG as base64 and its size. */
export type LiveFrame = { base64: string; width: number; height: number };

/**
 * Deletes a picture the app made of a sheet: a sheet carries a child's name
 * and the app has no reason to keep it once it has been read.
 *
 * Only files in the app's own cache are touched — never a photo in the
 * person's gallery — and a file already gone is not an error.
 */
export async function forgetPicture(uri: string | null | undefined): Promise<void> {
  const cache = FileSystem.cacheDirectory;
  if (!uri || !cache || !uri.startsWith(cache)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

/**
 * One frame for the live reader, made as quietly and as small as the camera
 * allows.
 *
 * - `pictureRef`: the picture stays a native image in memory — no file of
 *   the full-size frame is ever written. Expo's `skipProcessing` is not used:
 *   it is Android-only, writes the raw JPEG to a file, reports the sensor's
 *   size rather than the upright one, and with `pictureRef` its promise never
 *   settles (expo-camera 57, `ResolveTakenPicture.kt`).
 * - `shutterSound: false`: no click on every frame (iOS mutes it the way Expo
 *   can; a phone sold where the law requires the click still clicks).
 * - `quality` only matters on iOS, where the picture passes through a JPEG
 *   before it becomes the ref; low is quicker and the shrink below hides it.
 *
 * The manipulator shrinks it to `side` on the long edge and hands back the
 * JPEG; the file it writes on the way is deleted at once.
 */
export async function grabFrame(camera: CameraView, side: number): Promise<LiveFrame> {
  const picture = await camera.takePictureAsync({ pictureRef: true, quality: 0.5, shutterSound: false });
  const long = Math.max(picture.width, picture.height);
  const context = ImageManipulator.manipulate(picture);
  try {
    if (long > side) context.resize(picture.width >= picture.height ? { width: side } : { height: side });
    const small = await context.renderAsync();
    try {
      const saved = await small.saveAsync({ base64: true, compress: 0.8, format: SaveFormat.JPEG });
      void forgetPicture(saved.uri);
      if (!saved.base64) throw new Error("frame");
      return { base64: saved.base64, width: saved.width, height: saved.height };
    } finally {
      small.release();
    }
  } finally {
    context.release();
    picture.release();
  }
}
