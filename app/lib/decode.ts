// Deterministic image decode, shared by the app and the test harness.
//
// The rest of the pipeline (grayscaleNormalize + resizeBilinear in lib/preprocess) was
// already shared so both sides feed tesseract identical pixels — but DECODING was not.
// A browser's JPEG decoder and Jimp's disagree on ~6% of bytes for the same file (max
// delta 56), which is enough to flip marginal glyphs and make the app and CI report
// different rows for the same screenshot. Decoding through the same JS in Node and in
// the browser closes that gap — and also makes the app's own results independent of
// which browser engine it runs in. tests/parity-browser.mjs guards this.
import jpeg from "jpeg-js";
import pako from "pako";

export type Decoded = { data: Uint8ClampedArray; width: number; height: number };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
export const isPng = (b: Uint8Array) => b.length > 8 && PNG_SIG.every((v, i) => b[i] === v);

// `useTArray` keeps the output a Uint8Array; without it jpeg-js allocates a Node Buffer.
export function decodeJpeg(bytes: Uint8Array): Decoded {
  const r = jpeg.decode(bytes, { useTArray: true });
  return { data: new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), width: r.width, height: r.height };
}

// Minimal PNG decoder — enough for screenshots: 8-bit, non-interlaced, any colour type
// (grey, RGB, palette, grey+alpha, RGBA). 16-bit samples are narrowed to 8 by taking the
// high byte. Interlaced (Adam7) and bit depths below 8 are refused rather than guessed;
// callers fall back to the platform decoder, giving up determinism but not correctness.
export function decodePng(bytes: Uint8Array): Decoded {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 0, colour = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  for (let p = 8; p + 8 <= bytes.length;) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = dv.getUint32(p + 8); height = dv.getUint32(p + 12);
      depth = bytes[p + 16]; colour = bytes[p + 17];
      if (bytes[p + 20] !== 0) throw new Error("PNG: interlaced images are not supported");
      if (depth !== 8 && depth !== 16) throw new Error(`PNG: unsupported bit depth ${depth}`);
    } else if (type === "PLTE") palette = body.slice();
    else if (type === "tRNS") trns = body.slice();
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    p += 12 + len; // length + type + data + crc
  }
  if (!width || !height) throw new Error("PNG: missing IHDR");

  // one flat buffer, then inflate the concatenated IDAT stream
  let total = 0; for (const c of idat) total += c.length;
  const z = new Uint8Array(total);
  let at = 0; for (const c of idat) { z.set(c, at); at += c.length; }
  const raw = pako.inflate(z);

  const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const ch = CHANNELS[colour];
  if (!ch) throw new Error(`PNG: unsupported colour type ${colour}`);
  const bpp = Math.max(1, (ch * depth) >> 3);      // bytes per pixel, for the filters
  const stride = (width * ch * depth) >> 3;        // bytes per scanline, excluding the filter byte

  // Undo the per-scanline filters (PNG spec §9.2): each line stores a filter type byte,
  // then bytes predicted from the pixel to the left (a), above (b) and above-left (c).
  const lines = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = (y * (stride + 1)) + 1;
    const cur = y * stride, prev = cur - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? lines[cur + i - bpp] : 0;
      const b = y > 0 ? lines[prev + i] : 0;
      const c = (y > 0 && i >= bpp) ? lines[prev + i - bpp] : 0;
      let v: number;
      if (ft === 0) v = x;
      else if (ft === 1) v = x + a;
      else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else if (ft === 4) {                          // Paeth
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`PNG: unknown filter ${ft}`);
      lines[cur + i] = v & 0xff;
    }
  }

  // Expand whatever colour type this is into RGBA, narrowing 16-bit samples to their
  // high byte (the low byte is below what OCR can use anyway).
  const step = depth === 16 ? 2 : 1;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * ch * step, d = (y * width + x) * 4;
      if (colour === 3) {
        const idx = lines[s] * 3;
        out[d] = palette![idx]; out[d + 1] = palette![idx + 1]; out[d + 2] = palette![idx + 2];
        out[d + 3] = trns && lines[s] < trns.length ? trns[lines[s]] : 255;
      } else if (colour === 0 || colour === 4) {
        const g = lines[s];
        out[d] = g; out[d + 1] = g; out[d + 2] = g;
        out[d + 3] = colour === 4 ? lines[s + step] : 255;
      } else {
        out[d] = lines[s]; out[d + 1] = lines[s + step]; out[d + 2] = lines[s + 2 * step];
        out[d + 3] = colour === 6 ? lines[s + 3 * step] : 255;
      }
    }
  }
  return { data: out, width, height };
}

// Decode any format this pipeline handles deterministically. Returns null when the bytes
// are something else (or a PNG variant the decoder refuses), so the caller can fall back.
export function decodeImage(bytes: Uint8Array): Decoded | null {
  if (isJpeg(bytes)) return decodeJpeg(bytes);
  if (isPng(bytes)) return decodePng(bytes);
  return null;
}
