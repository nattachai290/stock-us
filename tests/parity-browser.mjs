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
// Run: npm run test:parity   (CI installs Chromium; CHROME_PATH overrides the browser)
import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
import Jimp from 'jimp';
import fs from 'fs';

const FNV = "(u8)=>{let h=0x811c9dc5;for(let i=0;i<u8.length;i++){h^=u8[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16);}";
const fnv = eval(FNV);
const SCALE = 2;
// Both formats the picker accepts. The PNG is derived from a fixture at run time so no
// extra binary lives in the repo; what matters is that the decode path is exercised.
const jpgPath = 'tests/fixtures/th-stock-13.jpg';
const pngPath = '.ci/parity-sample.png';

const esm = execSync('npx esbuild app/lib/decode.ts --format=esm --bundle').toString();
const { decodeImage, decodePng } = await import('data:text/javascript;base64,' + Buffer.from(esm).toString('base64'));
const pre = execSync('npx esbuild app/lib/preprocess.ts --format=esm').toString();
const { grayscaleInvert, resizeBilinear } = await import('data:text/javascript;base64,' + Buffer.from(pre).toString('base64'));

// build the PNG sample (a real PNG encoder, so this is not our own bytes round-tripping)
fs.mkdirSync('.ci', { recursive: true });
const asPng = await Jimp.read(jpgPath);
fs.writeFileSync(pngPath, await asPng.getBufferAsync(Jimp.MIME_PNG));

// the PNG decoder must agree with an independent reference before parity means anything
{
  const ref = await Jimp.read(pngPath);
  const mine = decodePng(new Uint8Array(fs.readFileSync(pngPath)));
  const r = new Uint8ClampedArray(ref.bitmap.data.buffer, ref.bitmap.data.byteOffset, ref.bitmap.data.length);
  let bad = 0; for (let i = 0; i < r.length; i++) if (mine.data[i] !== r[i]) bad++;
  console.log(bad === 0 ? '✅ PNG decoder matches reference' : `❌ PNG decoder differs on ${bad} bytes`);
  if (bad) process.exit(1);
}

const iifeDec = execSync('npx esbuild app/lib/decode.ts --format=iife --global-name=DEC --bundle').toString();
const iifePre = execSync('npx esbuild app/lib/preprocess.ts --format=iife --global-name=PRE --bundle').toString();
// CI installs its own Chromium (playwright resolves it); locally fall back to the
// preinstalled one. CHROME_PATH overrides both.
const SANDBOX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const exe = process.env.CHROME_PATH || (fs.existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
await page.addScriptTag({ content: iifeDec });
await page.addScriptTag({ content: iifePre });

let ok = true;
for (const file of [jpgPath, pngPath]) {
  const bytes = fs.readFileSync(file);

  // ---- CI path (what tests/ocr.test.mjs does) ----
  const dec = decodeImage(new Uint8Array(bytes));
  grayscaleInvert(dec.data);
  const r = resizeBilinear(dec.data, dec.width, dec.height, SCALE);
  const ciBefore = fnv(r.data);
  const png = await new Jimp({ data: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.length), width: r.width, height: r.height })
    .getBufferAsync(Jimp.MIME_PNG);
  const back = await Jimp.read(png);
  const ciAfter = fnv(new Uint8ClampedArray(back.bitmap.data.buffer, back.bitmap.data.byteOffset, back.bitmap.data.length));

  // ---- App path (what OcrImport.preprocess does in a real browser) ----
  const out = await page.evaluate(async ([b64, scale, fnvSrc]) => {
    const H = eval(fnvSrc);
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const src = DEC.decodeImage(u8);
    PRE.grayscaleInvert(src.data);
    const rr = PRE.resizeBilinear(src.data, src.width, src.height, scale);
    const before = H(rr.data);
    const c = document.createElement('canvas');
    c.width = rr.width; c.height = rr.height;
    c.getContext('2d').putImageData(new ImageData(rr.data, rr.width, rr.height), 0, 0);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    const bmp = await createImageBitmap(blob);           // decode it back, as tesseract will
    const c2 = document.createElement('canvas');
    c2.width = bmp.width; c2.height = bmp.height;
    c2.getContext('2d').drawImage(bmp, 0, 0);
    return { before, after: H(c2.getContext('2d').getImageData(0, 0, c2.width, c2.height).data) };
  }, [bytes.toString('base64'), SCALE, FNV]);

  const same = ciBefore === out.before && out.before === out.after && ciBefore === ciAfter;
  ok = ok && same;
  console.log(`${same ? '✅' : '❌'} ${file}  CI=${ciBefore}/${ciAfter}  app=${out.before}/${out.after}`);
}
await browser.close();
console.log(ok
  ? '\nPARITY OK — the browser and CI hand tesseract identical pixels'
  : '\nPARITY BROKEN — the app and CI would disagree on the same file');
process.exit(ok ? 0 : 1);
