import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export class PhotoError extends Error {
  constructor(readonly code: "photo_type" | "photo_too_large" | "photo_unreadable") {
    super(code);
  }
}

/** Checks the file's real signature, not its name or the browser's claimed type. */
function sniff(b: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

/**
 * Re-encodes a photo as a plain JPEG (customer photos: max 1600 px; product photos use a larger
 * size): it is decoded and drawn again, so metadata (GPS location, camera serials, embedded
 * thumbnails) and any non-image content are dropped. Only the first frame of animated images is kept.
 */
export async function processPhoto(input: Uint8Array, { maxSide = 1600, quality = 82 }: { maxSide?: number; quality?: number } = {}) {
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new PhotoError("photo_too_large");
  if (!sniff(input)) throw new PhotoError("photo_type");
  try {
    const { data, info } = await sharp(input, { limitInputPixels: 40_000_000, failOn: "error", pages: 1 })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      bytes: new Uint8Array(data),
      width: info.width,
      height: info.height,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  } catch {
    throw new PhotoError("photo_unreadable");
  }
}
