import { decode as bytesOf } from "base64-arraybuffer";
import { decode as decodeJpeg } from "jpeg-js";

import { toGray, type GrayImage } from "./omr";

/**
 * A camera frame, as the image manipulator hands it over (JPEG, base64), made
 * into the luminance the reader works on — in JavaScript, on the phone.
 *
 * jpeg-js is the decoder the edge function uses too (same version), so a
 * frame read here and a photo read on the server go through the same steps.
 * RGB without the alpha channel is a quarter less to write, and `toGray`
 * reads three channels as well as four. The limits refuse anything far larger
 * than a live frame, so a stray full-size photo cannot take the phone's memory.
 */
export function grayFromJpeg(base64: string): GrayImage {
  const decoded = decodeJpeg(new Uint8Array(bytesOf(base64)), {
    useTArray: true, formatAsRGBA: false, maxResolutionInMP: 4, maxMemoryUsageInMB: 96,
  });
  return toGray(decoded.data, decoded.width, decoded.height, 3);
}
