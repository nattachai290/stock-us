// Deterministic image decode, shared by the app and the test harness.
//
// The rest of the pipeline (grayscaleInvert + resizeBilinear in lib/preprocess) was
// already shared so both sides feed tesseract identical pixels — but DECODING was not.
// A browser's JPEG decoder and Jimp's disagree on ~6% of bytes for the same file (max
// delta 56), which is enough to flip marginal glyphs and make the app and CI report
// different rows for the same screenshot. jpeg-js runs the same JS in Node and in the
// browser, so decoding through it closes that gap — and also makes the app's own results
// independent of which browser engine it runs in.
//
// `useTArray` keeps the output a Uint8Array; without it jpeg-js allocates a Node Buffer.
import jpeg from "jpeg-js";

export type Decoded = { data: Uint8ClampedArray; width: number; height: number };

export const isJpeg = (bytes: Uint8Array) =>
  bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export function decodeJpeg(bytes: Uint8Array): Decoded {
  const r = jpeg.decode(bytes, { useTArray: true });
  return { data: new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), width: r.width, height: r.height };
}
