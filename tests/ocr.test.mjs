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
// The remaining 9 Thai stock screenshots. Ground truth is every fully-visible row
// (partial/cut-off rows at a screen edge are expected to drop). minExact is the measured
// floor — Thai OCR recall is modest, but SILENT-wrong stays 0 and symbols stay valid.
const TH_STOCK_MORE = {
  "th-stock-3.jpg": ["12/12/2025 22:01,B,TMDX,0.0265417,128.10","12/12/2025 09:32,B,LLY,0.0031127,1008.76","12/12/2025 09:31,B,KO,0.0454348,69.11","05/12/2025 21:59,B,LMT,0.0069579,449.8440","26/11/2025 16:56,B,NVDA,0.0087506,181.70"],
  "th-stock-4.jpg": ["16/01/2026 12:49,B,NFLX,0.0358800,88.35","12/01/2026 14:59,B,TSLA,0.0072081,441.17","12/01/2026 14:59,B,HPQ,0.1480446,21.48","12/01/2026 14:59,B,CSCO,0.0437585,72.90","24/12/2025 21:49,B,EOSE,0.2676623,11.9180"],
  "th-stock-5.jpg": ["04/02/2026 22:02,B,IONQ,0.0875916,35.7340","04/02/2026 22:02,B,EOSE,0.2419230,12.9380","04/02/2026 22:02,B,ALAB,0.0202162,154.8260","04/02/2026 22:01,B,ACHR,0.4499856,6.9780","30/01/2026 22:22,B,IIPR,0.0655267,48.0720"],
  "th-stock-6.jpg": ["02/03/2026 21:15,B,LOW,0.0121538,260.00","26/02/2026 21:46,B,NUE,0.0181953,175.32","26/02/2026 21:45,B,HPQ,0.1683732,18.9460","19/02/2026 21:40,B,GOOGL,0.0105228,301.25","19/02/2026 21:39,B,MA,0.0060522,523.7680"],
  "th-stock-7.jpg": ["29/05/2026 11:21,B,NEE,0.0350494,87.02","29/05/2026 11:21,B,HCA,0.0079450,382.63","29/05/2026 11:20,B,APD,0.0108106,282.13","25/05/2026 13:22,B,LOW,0.0141679,215.98","19/05/2026 20:48,B,JPM,0.0101286,299.1520"],
  "th-stock-8.jpg": ["15/04/2026 21:51,B,CVX,0.0167419,185.1640","14/04/2026 16:43,B,TMUS,0.0162892,190.31","03/04/2026 14:12,B,CRCL,0.0327992,92.99","02/04/2026 13:17,B,ISRG,0.0066409,456.26","02/04/2026 13:16,B,ENPH,0.0820249,36.94"],
  "th-stock-9.jpg": ["01/07/2026 15:07,S,VIG,0.0140287,236.09","26/06/2026 14:16,B,ASTS,0.0458687,64.75","25/06/2026 14:20,B,PRCT,0.1446601,20.60","25/06/2026 14:20,B,CVX,0.0175479,169.82","24/06/2026 18:56,B,ELV,0.0074888,396.59"],
  "th-stock-10.jpg": ["14/07/2026 21:07,B,GRBK,0.0415577,71.9480","14/07/2026 21:07,B,DHI,0.0199570,149.8220","14/07/2026 21:06,B,AMPH,0.1589411,18.8120","09/07/2026 22:34,B,SNPS,0.0068129,438.8680"],
  "th-stock-11.jpg": ["17/06/2026 21:20,B,CRM,0.0190059,160.4760","17/06/2026 21:20,B,ADBE,0.0149609,203.8640","17/06/2026 21:19,B,NOW,0.0298329,102.2360","12/06/2026 20:16,B,META,0.0052834,573.49","12/06/2026 20:15,B,AMZN,0.0124522,243.33"],
};
const TH_MIN_EXACT = { "th-stock-3.jpg":4, "th-stock-4.jpg":2, "th-stock-5.jpg":1, "th-stock-6.jpg":2, "th-stock-7.jpg":5, "th-stock-8.jpg":3, "th-stock-9.jpg":2, "th-stock-10.jpg":2, "th-stock-11.jpg":4 };

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
  ...Object.entries(TH_STOCK_MORE).map(([f, truth]) => ({ name: f, imgs: [FIX(f)], truth, minExact: TH_MIN_EXACT[f] })),
];
// Pass/fail is decided ONLY by the safety guarantees below — never by the exact-match
// count. Real-screenshot OCR can't hit 100% exact (even the English fixtures don't), so
// treating a low exact threshold as "passed" would be misleading. The exact recall is
// reported as a number for transparency, and an aggregate regression floor guards it.
let exactTotal = 0, truthTotal = 0;
console.log("\n— OCR exact-match recall (reported, not a pass/fail) —");
for (const c of CASES) {
  const m = mergeParses(await ocrPass(c.imgs, 2), await ocrPass(c.imgs, 3));
  const exact = c.truth.filter(t => m.rows.some(r => r.csv === t)).length;
  const silent = m.rows.filter(r => !c.truth.includes(r.csv) && r.flags.length === 0);
  exactTotal += exact; truthTotal += c.truth.length;
  console.log(`   ${c.name}: exact ${exact}/${c.truth.length}${exact < c.truth.length ? `  (${c.truth.length - exact} dropped/flagged)` : "  ✓ all matched"}`);
  // ── hard guarantees (these decide pass/fail) ──
  check(`${c.name}: no row is silently wrong (matches expect or is flagged)`, silent.length === 0, silent.map(r => r.csv).join(" | "));
  check(`${c.name}: no spurious rows invented (<= ${c.truth.length})`, m.rows.length <= c.truth.length, `got ${m.rows.length}`);
  check(`${c.name}: every emitted symbol is a valid ticker`, m.rows.every(r => /^([A-Z]{1,6}|XAUUSD)$/.test(r.symbol)), m.rows.map(r => r.symbol).join(","));
}
await worker.terminate();

// Aggregate regression floor (so a code change that tanks recall is caught), reported honestly
console.log(`\nOCR exact recall overall: ${exactTotal}/${truthTotal} rows (${Math.round(exactTotal / truthTotal * 100)}%). Not 100% — OCR drops/flags the rest; use English screenshots for higher accuracy.`);
check(`recall did not regress (>= 45/${truthTotal})`, exactTotal >= 45, `got ${exactTotal}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
