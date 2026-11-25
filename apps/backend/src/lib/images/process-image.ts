import { MedusaError } from "@medusajs/framework/utils";
import sharp from "sharp";

// Image work stays inside the memory budget of the server: one decoder thread,
// no cache of decoded images.
sharp.concurrency(1);
sharp.cache(false);

export const MAX_INPUT_PIXELS = 40_000_000;
export const MAX_LONG_EDGE = 2000;
export const WEBP_QUALITY = 82;

export type ImageType = "jpeg" | "png" | "webp";

export type ProcessImageOptions = {
  /** Largest number of input pixels the decoder may open. Defaults to 40,000,000. */
  limitInputPixels?: number;
};

export type ProcessedImage = {
  data: Buffer;
  width: number;
  height: number;
  format: "webp";
};

const refuse = (code: string, message: string): MedusaError =>
  new MedusaError(MedusaError.Types.INVALID_DATA, message, code);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decides the type from the first bytes only. The file name and the declared type play no part. */
export function detectImageType(buffer: Buffer): ImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

// An animated PNG carries an animation control chunk before the first image data chunk.
function isAnimatedPng(buffer: Buffer): boolean {
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (type === "acTL") {
      return true;
    }
    if (type === "IDAT" || type === "IEND") {
      return false;
    }
    offset += 12 + length;
  }
  return false;
}

// An animated WebP has an extended header whose flag byte has the animation bit set.
function isAnimatedWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 21 && buffer.toString("latin1", 12, 16) === "VP8X" && (buffer[20] & 0x02) !== 0
  );
}

/**
 * Turns an uploaded image into a clean WebP: turned upright from the camera
 * orientation, at most 2000 pixels on the long edge and never enlarged, and
 * carrying no metadata at all. Nothing of the source file reaches the output.
 * No call that keeps metadata is made, on purpose. Rejections are a
 * MedusaError of type invalid_data with one of the codes unsupported_type,
 * animated_image, image_pixels_exceeded or corrupt_image.
 */
export async function processImage(
  input: Buffer,
  options: ProcessImageOptions = {}
): Promise<ProcessedImage> {
  const type = detectImageType(input);
  if (!type) {
    throw refuse("unsupported_type", "Upload a JPEG, PNG or WebP image.");
  }
  if ((type === "png" && isAnimatedPng(input)) || (type === "webp" && isAnimatedWebp(input))) {
    throw refuse("animated_image", "Animated images are not accepted.");
  }

  try {
    const source = sharp(input, {
      limitInputPixels: options.limitInputPixels ?? MAX_INPUT_PIXELS,
      failOn: "error",
    });
    const metadata = await source.metadata();
    if ((metadata.pages ?? 1) > 1) {
      throw refuse("animated_image", "Animated images are not accepted.");
    }
    const { data, info } = await source
      .rotate()
      .resize({
        width: MAX_LONG_EDGE,
        height: MAX_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, format: "webp" };
  } catch (error) {
    if (error instanceof MedusaError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit/i.test(message)) {
      throw refuse("image_pixels_exceeded", "The image has too many pixels.");
    }
    throw refuse("corrupt_image", "The image could not be read.");
  }
}
