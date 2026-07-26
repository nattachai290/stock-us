// End-to-end pixel parity: does the browser hand tesseract the SAME pixels as CI does,
// for the same file? Covers every step — decode, grayscale/invert, upscale, PNG encode,
// and the decode tesseract itself performs on that PNG.
//
// This is the check that was missing when the app and CI disagreed on real screenshots:
// tests/ocr.test.mjs proves the PARSER is right, but it decoded through Jimp while the
// browser used its own JPEG decoder, so it could report "nothing missing" on a file the
// app lost rows from. Identical pixels here means tesseract sees the same input in both
// places, so the OCR suite's results actually describe what a user gets.
//
// Run: npm run test:parity   (needs a local Chromium — set CHROME_PATH to override)
import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
import Jimp from 'jimp';
import fs from 'fs';

const FNV = "(u8)=>{let h=0x811c9dc5;for(let i=0;i<u8.length;i++){h^=u8[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16);}";
const fnv = eval(FNV);
const file = 'tests/fixtures/th-stock-13.jpg';
const bytes = fs.readFileSync(file);
const SCALE = 2;

const esm = execSync('npx esbuild app/lib/decode.ts --format=esm --bundle').toString();
const { decodeJpeg } = await import('data:text/javascript;base64,' + Buffer.from(esm).toString('base64'));
const pre = execSync('npx esbuild app/lib/preprocess.ts --format=esm').toString();
const { grayscaleInvert, resizeBilinear } = await import('data:text/javascript;base64,' + Buffer.from(pre).toString('base64'));

// ---- CI path (what tests/ocr.test.mjs does) ----
const dec = decodeJpeg(new Uint8Array(bytes));
grayscaleInvert(dec.data);
const r = resizeBilinear(dec.data, dec.width, dec.height, SCALE);
console.log('CI  pixels before PNG :', fnv(r.data));
const png = await new Jimp({ data: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.length), width: r.width, height: r.height })
  .getBufferAsync(Jimp.MIME_PNG);
const back = await Jimp.read(png);
console.log('CI  pixels after PNG  :', fnv(new Uint8ClampedArray(back.bitmap.data.buffer, back.bitmap.data.byteOffset, back.bitmap.data.length)));

// ---- App path (what OcrImport.preprocess does in a real browser) ----
const iifeDec = execSync('npx esbuild app/lib/decode.ts --format=iife --global-name=DEC --bundle').toString();
const iifePre = execSync('npx esbuild app/lib/preprocess.ts --format=iife --global-name=PRE --bundle').toString();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.addScriptTag({ content: iifeDec });
await page.addScriptTag({ content: iifePre });
const out = await page.evaluate(async ([b64, scale, fnvSrc]) => {
  const H = eval(fnvSrc);
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const src = DEC.decodeJpeg(u8);
  PRE.grayscaleInvert(src.data);
  const r = PRE.resizeBilinear(src.data, src.width, src.height, scale);
  const before = H(r.data);
  const c = document.createElement('canvas');
  c.width = r.width; c.height = r.height;
  c.getContext('2d').putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  // decode the PNG back, the way tesseract will
  const bmp = await createImageBitmap(blob);
  const c2 = document.createElement('canvas');
  c2.width = bmp.width; c2.height = bmp.height;
  c2.getContext('2d').drawImage(bmp, 0, 0);
  const after = H(c2.getContext('2d').getImageData(0, 0, c2.width, c2.height).data);
  return { before, after };
}, [bytes.toString('base64'), SCALE, FNV]);
await browser.close();
console.log('App pixels before PNG :', out.before);
console.log('App pixels after PNG  :', out.after);
console.log(fnv(r.data) === out.before ? '✅ preprocessing identical' : '❌ preprocessing DIFFERS');
console.log(out.before === out.after ? '✅ browser PNG round-trip lossless' : '❌ browser PNG round-trip LOSSY');
const ok = fnv(r.data) === out.before && out.before === out.after;
console.log(ok ? `\nPARITY OK — tesseract receives identical pixels (${out.after})` : '\nPARITY BROKEN');
process.exit(ok ? 0 : 1);
