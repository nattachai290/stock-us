// Shared OCR preprocessing — used by BOTH the browser (OcrImport.tsx) and the Node
// test harness, so the pixels fed to tesseract are identical in both places. The
// browser's own drawImage smoothing is engine-dependent (Chromium, Safari and jimp
// each resample differently), which made the app and the tests disagree about which
// rows read cleanly on the same screenshot. A deterministic hand-rolled resize
// removes that variable everywhere: same input file → same OCR text, in the app on
// any device and in CI. (The one residual difference is JPEG decoding itself, which
// can vary by ±1 gray level between decoders — below tesseract's noise floor.)

// White-text-on-dark screenshots → black-on-white: grayscale then invert, in place.
export function grayscaleInvert(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    const g = 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = g;
  }
}

// Deterministic bilinear upscale of an RGBA buffer (center-aligned sampling).
export function resizeBilinear(
  src: Uint8ClampedArray, w: number, h: number, scale: number,
): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const out = new Uint8ClampedArray(new ArrayBuffer(W * H * 4));
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
      const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return { data: out, width: W, height: H };
}
