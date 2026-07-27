// Shared OCR preprocessing — used by BOTH the browser (OcrImport.tsx) and the Node
// test harness, so the pixels fed to tesseract are identical in both places. The
// browser's own drawImage smoothing is engine-dependent (Chromium, Safari and jimp
// each resample differently), which made the app and the tests disagree about which
// rows read cleanly on the same screenshot. A deterministic hand-rolled resize
// removes that variable everywhere: same input file → same OCR text, in the app on
// any device and in CI. (The one residual difference is JPEG decoding itself, which
// can vary by ±1 gray level between decoders — below tesseract's noise floor.)

// Tesseract wants dark text on a light background. Broker screenshots come in both
// themes, so which way to go is a property of the image, not a constant: grayscale, then
// invert ONLY when the page is dark. Inverting an already-light screenshot turns it into
// white-on-black and measurably costs reads — "OXY" came out as "0). 4'", "V" as "ง" and
// "BRK.B" as "ธ จ .8" purely from being inverted when it should not have been.
//
// The decision is the mean luminance over the whole image, which for a screenshot is
// dominated by its background. Deterministic and identical in the browser and in Node.
// Returns whether it inverted, for diagnostics.
export function grayscaleNormalize(d: Uint8ClampedArray): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;   // grayscale first; the invert decision needs the mean
    sum += g;
  }
  const dark = sum / (d.length / 4) < 128;
  if (dark) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
  return dark;
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
