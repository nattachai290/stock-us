// Regression tests for the OCR screenshot-import pipeline (app/lib/ocr.ts).
// Runs the REAL pipeline — preprocess (jimp mirrors the browser canvas steps) →
// tesseract.js OCR → parseActivityText → mergeParses — against real broker
// screenshots in tests/fixtures/ with hand-verified ground truth.
//
// Run: npm run test:ocr   (no network needed — language data comes from
// node_modules/@tesseract.js-data/eng, a devDependency)
//
// The hard invariant is SILENT WRONG === 0: a row may be wrong only if it
// carries a review flag. Exact-match counts are baselines from the tesseract
// version pinned in package-lock — if an upgrade drops them, investigate.

import Jimp from "jimp";
import { createWorker } from "tesseract.js";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = (f) => path.join(ROOT, "tests", "fixtures", f);

// compile the TS module on the fly so the test always runs the current source
const src = execSync("npx esbuild app/lib/ocr.ts --format=esm", { cwd: ROOT }).toString();
const { parseActivityText, mergeParses } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ FAIL " + name + (detail ? " — " + detail : "")); }
};

// ── Unit tests (no OCR, synthetic text) ───────────────────────────────────────

// Reproduction of a real bug: OCR missed the "Buy ARM" header of the December
// block, which used to overwrite the still-open Sell record's qty/price.
const passA = `
Results
July 2026
Buy ARM 12.09 USD
Executed Price 325.00 3 Jul 2026 - 06:03:10 PM
Shares 0.0371384
June 2026
Sell ARM 259.56 USD
Executed Price 441.75 18 Jun 2026 - 07:22:56 AM
Shares 0.5885681
December 2025
Executed Price 110.7580 23 Dec 2025 - 10:25:20 PM
Shares 0.1155672
`;
const passB = passA.replace("December 2025\nExecuted Price", "December 2025\nBuy ARM 399.74 THB\nExecuted Price");

{
  const m = mergeParses(parseActivityText(passA), parseActivityText(passB));
  const sell = m.rows.find(r => r.side === "S");
  check("missed-header: sell row uncontaminated", sell?.qtyStr === "0.5885681" && sell?.priceStr === "441.75", sell?.csv);
  const dec = m.rows.find(r => r.iso?.startsWith("2025-12"));
  check("missed-header: dec buy recovered + flagged", dec?.qtyStr === "0.1155672" && dec.flags.length > 0, dec?.csv);
  check("missed-header: 3 rows total", m.rows.length === 3);
}

{
  // Passes disagree on the sell price — the reading matching the printed USD total must win, silently
  const passC = passB.replace("Executed Price 441.75 18 Jun", "Executed Price 110.7580 18 Jun");
  const m = mergeParses(parseActivityText(passC), parseActivityText(passB));
  const sell = m.rows.find(r => r.side === "S");
  check("usd-tiebreak: arithmetic picks 441.75", sell?.priceStr === "441.75", sell?.csv);
  check("usd-tiebreak: no disagreement flag", !sell?.flags.some(f => f.includes("สองรอบ")), JSON.stringify(sell?.flags));
}

{
  // AM/PM edge cases + oldest-first ordering
  const t = `
Buy AAA 10.00 USD
Executed Price 10.00 5 Jan 2026 - 12:15:00 AM
Shares 1.0000000
Buy BBB 20.00 USD
Executed Price 20.00 4 Jan 2026 - 12:30:00 PM
Shares 1.0000000
`;
  const m = mergeParses(parseActivityText(t), parseActivityText(t));
  check("12 AM → 00:xx", m.rows.some(r => r.csv.startsWith("05/01/2026 00:15")));
  check("12 PM → 12:xx", m.rows.some(r => r.csv.startsWith("04/01/2026 12:30")));
  check("sorted oldest first", m.rows[0].symbol === "BBB");
}

{
  // Gold DCA layout: "Weight x oz" (4 decimals) instead of "Shares", THB total,
  // broker product name mapped to XAUUSD; the 7-decimal share flag must NOT fire.
  const t = `
November 2025
Buy MTS-GOLD 399.94 THB
Executed Price 4,127.68 25 Nov 2025 - 08:11:03 AM
Weight 0.0029 oz
`;
  const m = mergeParses(parseActivityText(t), parseActivityText(t));
  const g = m.rows[0];
  check("gold: mapped to XAUUSD", g?.symbol === "XAUUSD", g?.csv);
  check("gold: weight becomes qty", g?.qtyStr === "0.0029");
  check("gold: executed price kept", g?.priceStr === "4127.68");
  check("gold: no 7-decimal flag", !g?.flags.some(f => f.includes("ทศนิยม")), JSON.stringify(g?.flags));
  check("gold: isGold set", g?.isGold === true);
}

{
  // Thai gold layout (deterministic, no OCR): Thai side words, "ราคาที่ได้จริง" +
  // executed price on the date line, Buddhist year, Thai month, "น้ำหนัก x oz".
  const sell = `
ขาย MTS-GOLD 28.66 USD
ราคาที่ได้จริง 4,094.87 24 มิ.ย. 69 - 08:42:13 น.
น้ำหนัก 0.0070 oz
`;
  const m = mergeParses(parseActivityText(sell), parseActivityText(sell));
  const r = m.rows[0];
  check("thai: ขาย → Sell", r?.side === "S", r?.csv);
  check("thai: → XAUUSD", r?.symbol === "XAUUSD");
  check("thai: Buddhist 69 → 2026", r?.iso?.startsWith("2026-06-24"));
  check("thai: 24h time kept", r?.csv.startsWith("24/06/2026 08:42"));
  check("thai: exec price off date line", r?.priceStr === "4094.87");
  check("thai: weight → qty", r?.qtyStr === "0.0070");
  check("thai: USD cross-check ok", r?.check === "ok");

  const buy = `ซื้อ MTS-GOLD 14,000.96 บาท
ราคาที่ได้จริง 4,357.98 5 มิ.ย. 69 - 21:48:33 น.
น้ำหนัก 0.0976 oz`;
  const mb = mergeParses(parseActivityText(buy), parseActivityText(buy));
  check("thai: ซื้อ → Buy", mb.rows[0]?.side === "B", mb.rows[0]?.csv);
  check("thai: บาท total → THB (unverified)", mb.rows[0]?.currency === "THB" && mb.rows[0]?.check === "unverified");

  // A baht total is unambiguously a BUY, so a garbled side word need NOT flag there
  const bahtBuy = `MTS-GOLD 14,000.96 บาท
ราคาที่ได้จริง 4,357.98 5 มิ.ย. 69 - 21:48:33 น.
น้ำหนัก 0.0976 oz`;
  const mbb = mergeParses(parseActivityText(bahtBuy), parseActivityText(bahtBuy));
  check("thai: baht total → confident Buy (no side flag)", mbb.rows[0]?.side === "B" && !mbb.rows[0]?.flags.some(f => f.includes("ซื้อ/ขาย")), JSON.stringify(mbb.rows[0]));

  // A USD total is ambiguous (buy vs sale proceeds); with no readable side word it must flag
  const usdGarbled = `MTS-GOLD 28.66 USD
ราคาที่ได้จริง 4,094.87 24 มิ.ย. 69 - 08:42:13 น.
น้ำหนัก 0.0070 oz`;
  const mug = mergeParses(parseActivityText(usdGarbled), parseActivityText(usdGarbled));
  check("thai: USD total + unreadable side is flagged", mug.rows[0]?.flags.some(f => f.includes("ซื้อ/ขาย")), JSON.stringify(mug.rows[0]?.flags));

  // Thai stock: buy identified by baht total; sell by "ticker qty หุ้น"; ticker stays ASCII
  const stockBuy = `ซื้อ FSLR 99.80 บาท
ราคาที่ได้จริง 231.99 1 ก.ค. 69 - 17:06:48 น.
จำนวนหุ้น 0.0128022`;
  const msb = mergeParses(parseActivityText(stockBuy), parseActivityText(stockBuy));
  check("thai stock buy: FSLR B", msb.rows[0]?.csv === "01/07/2026 17:06,B,FSLR,0.0128022,231.99", msb.rows[0]?.csv);

  const stockSell = `ขาย OXY 0.1348522 หุ้น
ราคาที่ได้จริง 48.35 1 ก.ค. 69 - 20:21:02 น.`;
  const mss = mergeParses(parseActivityText(stockSell), parseActivityText(stockSell));
  check("thai stock sell: OXY S", mss.rows[0]?.csv === "01/07/2026 20:21,S,OXY,0.1348522,48.35", mss.rows[0]?.csv);

  // Corporate action (CA - แตกหรือรวมหุ้น) is dropped, not emitted as a bad row
  const ca = `รับ NFLX 0.0270022 หุ้น
CA - แตกหรือรวมหุ้น 17 พ.ย. 68 - 15:47:52 น.`;
  const mca = mergeParses(parseActivityText(ca), parseActivityText(ca));
  check("thai stock: corporate action dropped", mca.rows.length === 0, JSON.stringify(mca.rows.map(r => r.csv)));
}

// ── End-to-end OCR tests on real screenshots ──────────────────────────────────

const TRUTH_ALL = [
  "25/04/2024 11:25,B,ARM,0.1117126,96.05", "07/08/2024 00:13,B,ARM,0.0978371,114.4760",
  "02/01/2025 21:46,B,ARM,0.0917583,126.7460", "10/03/2025 21:40,B,ARM,0.0985205,119.3660",
  "12/04/2025 02:30,B,ARM,0.1132871,104.7780", "02/08/2025 02:24,B,ARM,0.0891816,137.2480",
  "30/09/2025 00:23,B,ARM,0.0879153,140.4760", "12/11/2025 21:13,B,ARM,0.0810042,151.35",
  "23/12/2025 22:25,B,ARM,0.1155672,110.7580", "18/06/2026 07:22,S,ARM,0.5885681,441.75",
  "03/07/2026 18:03,B,ARM,0.0371384,325.00",
];
const TRUTH_SINGLE = TRUTH_ALL.slice(-3);

// Gold DCA screenshot (MTS-GOLD, English) — Weight/oz, THB totals, all map to XAUUSD
const TRUTH_GOLD = [
  "12/11/2024 21:57,B,XAUUSD,0.0043,2611.23", "08/07/2025 01:20,B,XAUUSD,0.0036,3329.87",
  "22/10/2025 07:42,B,XAUUSD,0.0007,4078.18", "07/11/2025 21:47,B,XAUUSD,0.0030,3990.78",
  "25/11/2025 08:11,B,XAUUSD,0.0029,4127.68",
];
// Thai gold screenshot — Thai side words, Buddhist year, Thai months. Thai OCR of
// ซื้อ/ขาย is noisy, so the guarantee here is SILENT-wrong===0 (any misread side is
// flagged); exact ≥4/5 is the measured baseline.
const TRUTH_GOLD_THAI = [
  "26/05/2026 17:14,S,XAUUSD,0.0070,4527.64", "26/05/2026 18:50,S,XAUUSD,0.0220,4512.44",
  "05/06/2026 21:48,B,XAUUSD,0.0976,4357.98", "08/06/2026 09:05,S,XAUUSD,0.0080,4320.64",
  "24/06/2026 08:42,S,XAUUSD,0.0070,4094.87",
];
// Thai STOCK screenshots (ซื้อ/ขาย + US tickers, จำนวนหุ้น). Thai OCR of symbols/side is
// noisy, so the guarantee is SILENT-wrong===0 (mangled rows drop or flag). CA (รับ/หัก)
// rows are skipped. exact baselines are the measured minimums.
const TRUTH_TH_SELLS = [
  "01/07/2026 20:21,S,OXY,0.1348522,48.35", "01/07/2026 20:20,S,IVV,0.0045730,748.48",
  "01/07/2026 17:06,B,FSLR,0.0128022,231.99", "01/07/2026 15:09,S,QQQM,0.0126133,300.06",
  "01/07/2026 15:08,S,SPHD,0.0612187,50.96", "01/07/2026 15:08,S,SPY,0.0045788,745.00",
  "01/07/2026 15:08,S,SPYD,0.0668001,47.68",
];
const TRUTH_TH_CA = [
  "23/11/2025 14:40,B,ENPH,0.1143497,26.76", "19/11/2025 11:49,B,ALAB,0.0219307,139.53",
  "19/11/2025 11:48,B,MELI,0.0014788,2069.22", "17/11/2025 08:26,B,TEM,0.0450000,68.00",
];

// eng+tha, using the exact self-hosted data the browser ships (public/tesseract)
const worker = await createWorker("eng+tha", 1, {
  langPath: path.join(ROOT, "public", "tesseract"),
  gzip: true, cacheMethod: "none",
});
async function ocrPass(imgs, scale) {
  let text = "";
  for (const p of imgs) {
    const img = await Jimp.read(p);
    img.greyscale().invert().scale(scale); // mirrors OcrImport.tsx canvas preprocessing
    const { data } = await worker.recognize(await img.getBufferAsync(Jimp.MIME_PNG));
    text += data.text + "\n";
  }
  return parseActivityText(text);
}

const CASES = [
  { name: "3-image set", imgs: ["activity-1.jpg", "activity-2.jpg", "activity-3.jpg"].map(FIX), truth: TRUTH_ALL, minExact: 10 },
  { name: "single image", imgs: [FIX("activity-4-single.jpg")], truth: TRUTH_SINGLE, minExact: 2 },
  { name: "gold DCA (MTS-GOLD)", imgs: [FIX("gold-mts.jpg")], truth: TRUTH_GOLD, minExact: 5 },
  { name: "gold DCA Thai (MTS-GOLD)", imgs: [FIX("gold-mts-thai.jpg")], truth: TRUTH_GOLD_THAI, minExact: 4 },
  { name: "Thai stock sells", imgs: [FIX("th-stock-sells.jpg")], truth: TRUTH_TH_SELLS, minExact: 6 },
  { name: "Thai stock buys + CA-skip", imgs: [FIX("th-stock-ca.jpg")], truth: TRUTH_TH_CA, minExact: 3 },
];
for (const c of CASES) {
  const m = mergeParses(await ocrPass(c.imgs, 2), await ocrPass(c.imgs, 3));
  const exact = c.truth.filter(t => m.rows.some(r => r.csv === t)).length;
  const silent = m.rows.filter(r => !c.truth.includes(r.csv) && r.flags.length === 0);
  check(`${c.name}: SILENT wrong === 0 (hard invariant)`, silent.length === 0, silent.map(r => r.csv).join(" | "));
  check(`${c.name}: exact >= ${c.minExact}/${c.truth.length}`, exact >= c.minExact, `got ${exact}`);
  // never invent rows beyond the truth set (dropping a mangled row is safe; adding one is not)
  check(`${c.name}: no spurious rows (<= ${c.truth.length})`, m.rows.length <= c.truth.length, `got ${m.rows.length}`);
  // every emitted symbol is a clean ticker or XAUUSD — a Thai-mangled ticker must never ship
  check(`${c.name}: all symbols valid`, m.rows.every(r => /^([A-Z]{1,6}|XAUUSD)$/.test(r.symbol)), m.rows.map(r => r.symbol).join(","));
}
await worker.terminate();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
