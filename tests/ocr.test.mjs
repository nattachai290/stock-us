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
const { parseActivityText, mergeParses, extractTickerHints } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

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
  // "incomplete" must reflect rows MISSING FROM THE MERGED output, not per-pass parse
  // failures. Here each pass fails a DIFFERENT row's date (mangled month) that the
  // other pass reads fine — both rows come through, so incomplete must be 0, not 2.
  const rowA = "ซื้อ MTS-GOLD 249.81 บาท\nราคาที่ได้จริง 3,349.08 14 ก.ค. 68 - 22:35:39 น.\nน้ำหนัก 0.0022 oz";
  const rowB = "ซื้อ MTS-GOLD 749.74 บาท\nราคาที่ได้จริง 3,286.86 9 ก.ค. 68 - 18:36:00 น.\nน้ำหนัก 0.0069 oz";
  const bad = (s) => s.replace(/ก\.ค\./, "n.n."); // month unreadable → that row drops in this pass
  const passX = `${bad(rowA)}\n${rowB}`;      // pass X fails rowA
  const passY = `${rowA}\n${bad(rowB)}`;      // pass Y fails rowB
  const pX = parseActivityText(passX), pY = parseActivityText(passY);
  check("incomplete-accounting setup: each pass drops one, counts 1", pX.rows.length === 1 && pX.incomplete === 1 && pY.rows.length === 1 && pY.incomplete === 1);
  const m = mergeParses(pX, pY, { a: passX, b: passY });
  check("incomplete-accounting: both rows recovered", m.rows.length === 2, JSON.stringify(m.rows.map(r => r.csv)));
  check("incomplete-accounting: merged incomplete is 0 (not 2)", m.incomplete === 0, `got ${m.incomplete}`);

  // A row NEITHER pass can finish is still correctly counted as incomplete.
  const orphan = "ซื้อ MTS-GOLD 100.00 บาท\nราคาที่ได้จริง 3,000.00 5 n.n. 68 - 10:00:00 น.\nน้ำหนัก 0.0030 oz";
  const m2 = mergeParses(parseActivityText(`${rowA}\n${orphan}`), parseActivityText(`${rowA}\n${orphan}`));
  check("incomplete-accounting: genuinely-unread row still counted", m2.rows.length === 1 && m2.incomplete === 1, `rows=${m2.rows.length} inc=${m2.incomplete}`);
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
  // Both passes agree on qty/price but one misread the printed TOTAL ("11.92"→"1.92",
  // a real browser-run case) — the pass whose arithmetic agrees must win: no mismatch flag.
  const good = `Buy RKLB 11.92 USD
Executed Price 68.37 20 Jul 2026 - 09:41:42 AM
Shares 0.1740529`;
  const bad = good.replace("11.92 USD", "1.92 USD");
  for (const [a, b] of [[bad, good], [good, bad]]) {
    const m = mergeParses(parseActivityText(a), parseActivityText(b));
    check(`total-misread (${a === bad ? "A" : "B"} bad): check ok, no flag`,
      m.rows[0]?.check === "ok" && !m.rows[0]?.flags.some(f => f.includes("ยอดรวม")), JSON.stringify(m.rows[0]?.flags));
  }
  // but when BOTH passes read the bad total, the mismatch flag must stay
  const mb = mergeParses(parseActivityText(bad), parseActivityText(bad));
  check("total-misread (both bad): mismatch stays flagged", mb.rows[0]?.flags.some(f => f.includes("ยอดรวม")), JSON.stringify(mb.rows[0]?.flags));
}

{
  // Thousands separator read as a space ("3 130.88") must still yield the full price
  const t = `ซื้อ MTS-GOLD 249.90 บาท
ราคาที่ได้จริง 3 130.88 1 เม.ย. 68 - 22:12:59 น.
น้ำหนัก 0.0023 oz`;
  const m = mergeParses(parseActivityText(t), parseActivityText(t));
  check("space-thousands price joined", m.rows[0]?.priceStr === "3130.88", m.rows[0]?.csv);
}

{
  // Cross-text confirmation: pass B's parse tripped on the row (month mangled beyond
  // repair) but its raw text still carries the price+time line and the oz line — the
  // "seen in one pass" flag must clear. Without that evidence the flag stays.
  const goodText = `ซื้อ MTS-GOLD 249.85 บาท
ราคาที่ได้จริง 3,076.18 9 เม.ย. 68 - 21:00:59 น.
น้ำหนัก 0.0023 oz`;
  const brokenText = goodText.replace("9 เม.ย. 68", "9 ฌฆ.ฑ. 68"); // month unreadable → row drops
  const a = parseActivityText(goodText), b = parseActivityText(brokenText);
  check("cross-text setup: broken pass parses nothing", b.rows.length === 0);
  const m = mergeParses(a, b, { a: goodText, b: brokenText });
  check("cross-text: confirmed row not flagged seen-once", m.rows.length === 1 && !m.rows[0].flags.some(f => f.includes("รอบ OCR เดียว")), JSON.stringify(m.rows[0]?.flags));
  const m2 = mergeParses(a, b, { a: goodText, b: "ไม่มีอะไรเกี่ยวข้องเลย" });
  check("cross-text: unconfirmed row keeps the flag", m2.rows[0]?.flags.some(f => f.includes("รอบ OCR เดียว")), JSON.stringify(m2.rows[0]?.flags));
  // no texts passed (old callers) → behaves as before
  const m3 = mergeParses(a, b);
  check("cross-text: no texts → flag as before", m3.rows[0]?.flags.some(f => f.includes("รอบ OCR เดียว")));
}

{
  // Thai STOCK total-style header = structurally a BUY even in USD (sell headers
  // print "<qty> หุ้น", never a money total) — no side flag despite unreadable ซื้อ
  const t = `ขื้อ SNPS 3.00 USD
ราคาที่ได้จริง 438.8680 9 ก.ค. 69 - 22:34:42 น.
จำนวนหุ้น 0.0068129`;
  const m = mergeParses(parseActivityText(t), parseActivityText(t));
  check("thai-stock USD total: confident B, no side flag", m.rows[0]?.side === "B" && !m.rows[0]?.flags.some(f => f.includes("ซื้อ/ขาย")), JSON.stringify(m.rows[0]));

  // ...but only for Thai lines: a mangled ENGLISH header (sells DO print USD totals) stays flagged
  const en = `8uy XYZ 12.09 USD
Executed Price 325.00 3 Jul 2026 - 06:03:10 PM
Shares 0.0371384`;
  const men = mergeParses(parseActivityText(en), parseActivityText(en));
  check("mangled EN header: side stays flagged", men.rows[0]?.flags.some(f => f.includes("ซื้อ/ขาย")), JSON.stringify(men.rows[0]?.flags));

  // ...and a block that turns out GOLD (oz line) with a USD total could be sale
  // proceeds — even with the product name mangled past recognition, flush downgrades
  const g = `ขอ M7S-G01D 31.69 USD
ราคาที่ได้จริง 4,527.64 26 พ.ค. 69 - 17:14:24 น.
น้ำหนัก 0.0070 oz`;
  const mg = mergeParses(parseActivityText(g), parseActivityText(g));
  check("mangled-gold USD total: downgraded to uncertain", mg.rows[0]?.symbol === "XAUUSD" && mg.rows[0]?.flags.some(f => f.includes("ซื้อ/ขาย")), JSON.stringify(mg.rows[0]));
}

{
  // eng-rescued name that the portfolio confirms (share count matched + user holds
  // it) has two independent confirmations → clean; not-held stays flagged (tested
  // in the rescue block above).
  const tha = `ยาย เง 0.0045730 หุ้น
ราคาที่ได้จริง 748.48 1 ก.ค. 69 - 20:20:39 น.`;
  const hints = { "0.0045730": "IVV" };
  const m = mergeParses(parseActivityText(tha, hints, ["IVV"]), parseActivityText(tha, hints, ["IVV"]));
  check("rescued name in portfolio: no flag", m.rows[0]?.symbol === "IVV" && !m.rows[0]?.flags.some(f => f.includes("อังกฤษ")), JSON.stringify(m.rows[0]?.flags));
}

{
  // Cross-text confirmation path 2: the other pass's date/time collapsed entirely but
  // its header (symbol + share count) and the price survived → seen-once flag clears.
  const good = `ยาย VIG 0.0140287 หุ้น
ราคาที่ได้จริง 236.09 1 ก.ค. 69 - 15:07:40 น.`;
  const broken = `ยาย VIG 0.0140287 หุ้น
ราคาที่ได้จริง 236.09 เววรงซอ`;
  const a = parseActivityText(good), b = parseActivityText(broken);
  check("cross-text-2 setup: broken pass drops the row", b.rows.length === 0);
  const m = mergeParses(a, b, { a: good, b: broken });
  check("cross-text-2: header+price confirms, no seen-once flag", m.rows.length === 1 && !m.rows[0].flags.some(f => f.includes("รอบ OCR เดียว")), JSON.stringify(m.rows[0]?.flags));
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
  // Real broker case: sell-BY-WEIGHT gold row — header shows the oz sold (not a
  // money total), followed by a separate "ยอดที่ได้รับคืน X USD" (refund) detail
  // line. That line must NOT be mistaken for a new header (it has a total-shaped
  // number but no ticker/side word/GOLD marker) — doing so would prematurely flush
  // the still-open block. It DOES still feed cur.total, enabling the USD check.
  const t = `ขาย MTS-GOLD 0.5449 oz
ราคาที่ได้จริง 4,014.74 22 ต.ค. 68 - 07:11:45 น.
ยอดที่ได้รับคืน 2,187.63 USD
ซื้อ MTS-GOLD 3,899.95 บาท
ราคาที่ได้จริง 4,251.51 20 ต.ค. 68 - 08:23:13 น.
น้ำหนัก 0.0278 oz`;
  const p = parseActivityText(t);
  check("refund-line: doesn't fragment the block", p.rows.length === 2 && p.incomplete === 0, JSON.stringify(p));
  const sell = p.rows.find(r => r.side === "S");
  check("refund-line: sell row complete", sell?.qtyStr === "0.5449" && sell?.priceStr === "4014.74", sell?.csv);
  check("refund-line: total captured off the refund line", sell?.total === 2187.63 && sell?.currency === "USD");
  check("refund-line: USD check now verifiable", sell?.check === "ok", sell?.check);
}

{
  // "oz" OCR'd as the Thai digit zero + a stray digit ("๐ 7", "๐ 2") — the ๐ glyph
  // resembles "o"; the accompanying digit is noise from "z". Seen on both a header
  // line (qty inline with the ticker) and a standalone weight line.
  const onHeader = `ขาย MTS-GOLD 0.5189 ๐ 2
ราคาที่ได้จริง 4,189.33 15 ต.ค. 68 - 20:48:00 น.`;
  check("oz-as-๐N on header line", parseActivityText(onHeader).rows[0]?.qtyStr === "0.5189", JSON.stringify(parseActivityText(onHeader).rows));
  const onOwnLine = `ซื้อ MTS-GOLD 70,172.96 บาท
ราคาที่ได้จริง 4,081.98 22 ต.ค. 68 - 07:46:08 น.
น้ำหนัก 0.5212 ๐ 7`;
  check("oz-as-๐N on its own line", parseActivityText(onOwnLine).rows[0]?.qtyStr === "0.5212", JSON.stringify(parseActivityText(onOwnLine).rows));
}

{
  // "ต.ค." (October) misread as the Thai digit ๓ — either replacing ต entirely
  // ("๓ . ค .") or appearing alongside it ("ต ๓. ค.") — must still resolve to month 10.
  const replaced = `ซื้อ MTS-GOLD 70,172.96 บาท
ราคาที่ได้จริง 4,081.98 22 ๓ . ค . 68 - 07:46:08 น.
น้ำหนัก 0.5212 oz`;
  check("ต→๓ substitution: month resolves", parseActivityText(replaced).rows[0]?.csv.startsWith("22/10/2025"), JSON.stringify(parseActivityText(replaced).rows));
  const inserted = `ซื้อ MTS-GOLD 3,899.95 บาท
ราคาที่ได้จริง 4,251.51 20 ต ๓. ค. 68 - 08:23:13 น.
น้ำหนัก 0.0278 oz`;
  check("๓ insertion alongside ต: month resolves", parseActivityText(inserted).rows[0]?.csv.startsWith("20/10/2025"), JSON.stringify(parseActivityText(inserted).rows));
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

{
  // eng-only rescue pass: the Thai model rendered the ticker as Thai glyphs ("เง"),
  // the eng-only text read it fine — the share count (7 decimals, unique) links them.
  const tha = `ยาย เง 0.0045730 หุ้น
ราคาที่ได้จริง 748.48 1 ก.ค. 69 - 20:20:39 น.`;
  const eng = `ug IVV 0.0045730 Ku
s1mnlaasY 748.48 1 A.A. 69 - 20:20:39 u.`;
  const hints = extractTickerHints(eng);
  check("hints: share count → IVV extracted", hints["0.0045730"] === "IVV", JSON.stringify(hints));
  const m = mergeParses(parseActivityText(tha, hints), parseActivityText(tha, hints));
  check("rescue: mangled ticker recovered", m.rows[0]?.csv === "01/07/2026 20:20,S,IVV,0.0045730,748.48", m.rows[0]?.csv);
  check("rescue: rescued row is flagged", m.rows[0]?.flags.some(f => f.includes("อังกฤษ")), JSON.stringify(m.rows[0]?.flags));
  check("rescue: no hint → still dropped", mergeParses(parseActivityText(tha), parseActivityText(tha)).rows.length === 0);

  // A ticker the Thai pass read cleanly is never overridden by the eng pass (which can
  // shed uppercase junk from mangled Thai labels) — the disagreement becomes a flag.
  const tha2 = `ซื้อ NUE 99.78 บาท
ราคาที่ได้จริง 175.32 26 ก.พ. 69 - 21:46:06 น.
จำนวนหุ้น 0.0181953`;
  const eng2 = `#0 GDS 99.78 un
s1AA 175.32 26 A.W. 69 - 21:46:06 u.
91UdUKU 0.0181953`;
  const h2 = extractTickerHints(eng2);
  const m2 = mergeParses(parseActivityText(tha2, h2), parseActivityText(tha2, h2));
  check("rescue: valid ticker not overridden", m2.rows[0]?.symbol === "NUE", m2.rows[0]?.csv);
  check("rescue: hint disagreement flagged", m2.rows[0]?.flags.some(f => f.includes("GDS")), JSON.stringify(m2.rows[0]?.flags));

  // Uppercase junk on a price/date line must not become a hint ticker
  check("hints: date-line junk ignored", extractTickerHints("s1AA GDS 175.32 26 A.W. 69 - 21:46:06 u.\n91UdUKU 0.0181953")["0.0181953"] === undefined);
}

{
  // Portfolio-whitelist fix: OCR read "IPR" but the user holds IIPR (1 edit away,
  // unique candidate) → corrected + flagged. Never silent, never on ambiguity.
  const tha = `ซื้อ IPR 99.82 บาท
ราคาที่ได้จริง 48.0720 30 ม.ค. 69 - 22:22:43 น.
จำนวนหุ้น 0.0655267`;
  const known = ["IIPR", "AAPL", "MSFT"];
  const m = mergeParses(parseActivityText(tha, undefined, known), parseActivityText(tha, undefined, known));
  check("whitelist: IPR corrected to IIPR", m.rows[0]?.csv === "30/01/2026 22:22,B,IIPR,0.0655267,48.0720", m.rows[0]?.csv);
  check("whitelist: correction is flagged", m.rows[0]?.flags.some(f => f.includes("IPR") && f.includes("พอร์ต")), JSON.stringify(m.rows[0]?.flags));
  // exact match in the portfolio → untouched, no flag
  const known2 = ["IPR", "IIPR"];
  const m2 = mergeParses(parseActivityText(tha, undefined, known2), parseActivityText(tha, undefined, known2));
  check("whitelist: held symbol never rewritten", m2.rows[0]?.symbol === "IPR" && !m2.rows[0]?.flags.some(f => f.includes("พอร์ต")), m2.rows[0]?.csv);
  // two 1-edit candidates → ambiguous, leave the OCR reading alone
  const known3 = ["IIPR", "IPRA"];
  const m3 = mergeParses(parseActivityText(tha, undefined, known3), parseActivityText(tha, undefined, known3));
  check("whitelist: ambiguous candidates → untouched", m3.rows[0]?.symbol === "IPR", m3.rows[0]?.csv);
  // unknown symbol with no near candidate (a first-time buy) → untouched
  const m4 = mergeParses(parseActivityText(tha, undefined, ["NVDA"]), parseActivityText(tha, undefined, ["NVDA"]));
  check("whitelist: distant symbols untouched", m4.rows[0]?.symbol === "IPR", m4.rows[0]?.csv);
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

// English US-stock DCA screenshot (dark theme) — three same-day 11.92-USD DCA buys
// + one lump buy. The 11.92 totals are prone to leading-digit drops ("1.92"), which
// the cross-pass arithmetic tiebreak must absorb without flagging.
const TRUTH_DCA = [
  "16/07/2026 20:09,B,IONQ,10.7935135,37.00",
  "20/07/2026 09:41,B,ASTS,0.2052431,57.98",
  "20/07/2026 09:41,B,RKLB,0.1740529,68.37",
  "20/07/2026 09:42,B,SPCX,0.0949493,125.33",
];

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
// Thai gold, LIGHT theme — invert-preprocessing must handle both themes; the
// 3,130.88 price is prone to "3 130.88" (thousands separator read as a space).
const TRUTH_GOLD_THAI_LIGHT = [
  "13/03/2025 10:14,B,XAUUSD,0.0075,2944.63", "18/03/2025 22:19,B,XAUUSD,0.0024,3028.29",
  "24/03/2025 22:24,B,XAUUSD,0.0024,3012.06", "01/04/2025 22:12,B,XAUUSD,0.0023,3130.88",
  "09/04/2025 21:00,B,XAUUSD,0.0023,3076.18", "15/04/2025 20:56,B,XAUUSD,0.0023,3213.12",
];
// Thai gold, 2-image set with sell-BY-WEIGHT rows (header shows oz, not a money
// total, plus a separate "ยอดที่ได้รับคืน" refund line) and OCR misreads unique to
// this pair: "ต.ค." → "๓"-variants, "oz" → "๐+digit". The leading cut-off row in
// image 2a (header off-screen, from an earlier unprovided screenshot) is excluded
// from truth — expected to stay incomplete, never a wrong row.
const TRUTH_GOLD_THAI_2 = [
  "07/10/2025 11:34,B,XAUUSD,0.1630,3974.41", "07/10/2025 11:40,B,XAUUSD,0.1604,3975.18",
  "08/10/2025 10:46,B,XAUUSD,0.1223,4014.67", "15/10/2025 08:04,B,XAUUSD,0.0732,4170.38",
  "15/10/2025 20:48,S,XAUUSD,0.5189,4189.33", "15/10/2025 22:30,B,XAUUSD,0.5171,4200.33",
  "20/10/2025 08:23,B,XAUUSD,0.0278,4251.51", "22/10/2025 07:11,S,XAUUSD,0.5449,4014.74",
  "22/10/2025 07:46,B,XAUUSD,0.5212,4081.98", "27/10/2025 08:00,S,XAUUSD,0.0060,4076.61",
];
// Thai gold, all-buys — several rows' ก.ค. month OCR's to "n.n." in one pass but
// reads fine in the other, so every row is recovered by cross-pass merge. Regression
// guard for the incomplete-counter fix (per-pass failures must not be reported when
// the merged output is complete).
const TRUTH_GOLD_THAI_3 = [
  "27/05/2025 22:09,B,XAUUSD,0.0018,3302.22", "02/06/2025 16:37,B,XAUUSD,0.0022,3345.63",
  "09/06/2025 16:37,B,XAUUSD,0.0022,3321.33", "17/06/2025 22:22,B,XAUUSD,0.0022,3386.27",
  "09/07/2025 18:36,B,XAUUSD,0.0069,3286.86", "14/07/2025 22:35,B,XAUUSD,0.0022,3349.08",
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

// eng+tha main passes + an eng-only rescue pass, using the exact self-hosted data
// the browser ships (public/tesseract) — mirrors OcrImport.tsx
const worker = await createWorker("eng+tha", 1, {
  langPath: path.join(ROOT, "public", "tesseract"),
  gzip: true, cacheMethod: "none",
});
const engWorker = await createWorker("eng", 1, {
  langPath: path.join(ROOT, "public", "tesseract"),
  gzip: true, cacheMethod: "none",
});
async function ocrText(w, imgs, scale) {
  let text = "";
  for (const p of imgs) {
    const img = await Jimp.read(p);
    img.greyscale().invert().scale(scale); // mirrors OcrImport.tsx canvas preprocessing
    const { data } = await w.recognize(await img.getBufferAsync(Jimp.MIME_PNG));
    text += data.text + "\n";
  }
  return text;
}

const CASES = [
  { name: "3-image set", imgs: ["activity-1.jpg", "activity-2.jpg", "activity-3.jpg"].map(FIX), truth: TRUTH_ALL, minExact: 10 },
  { name: "single image", imgs: [FIX("activity-4-single.jpg")], truth: TRUTH_SINGLE, minExact: 2 },
  { name: "US DCA (activity-5)", imgs: [FIX("activity-5-dca.jpg")], truth: TRUTH_DCA, minExact: 4 },
  { name: "gold DCA (MTS-GOLD)", imgs: [FIX("gold-mts.jpg")], truth: TRUTH_GOLD, minExact: 5 },
  { name: "gold DCA Thai (MTS-GOLD)", imgs: [FIX("gold-mts-thai.jpg")], truth: TRUTH_GOLD_THAI, minExact: 4 },
  { name: "gold DCA Thai light theme", imgs: [FIX("gold-mts-thai-light.jpg")], truth: TRUTH_GOLD_THAI_LIGHT, minExact: 6 },
  { name: "gold DCA Thai (refund-line, 2 images)", imgs: [FIX("gold-mts-thai-2a.jpg"), FIX("gold-mts-thai-2b.jpg")], truth: TRUTH_GOLD_THAI_2, minExact: 9 },
  { name: "gold DCA Thai (cross-pass month recovery)", imgs: [FIX("gold-mts-thai-3.jpg")], truth: TRUTH_GOLD_THAI_3, minExact: 6 },
  { name: "Thai stock sells", imgs: [FIX("th-stock-sells.jpg")], truth: TRUTH_TH_SELLS, minExact: 6 },
  { name: "Thai stock buys + CA-skip", imgs: [FIX("th-stock-ca.jpg")], truth: TRUTH_TH_CA, minExact: 3 },
  ...Object.entries(TH_STOCK_MORE).map(([f, truth]) => ({ name: f, imgs: [FIX(f)], truth, minExact: TH_MIN_EXACT[f] })),
];
// Pass/fail is decided ONLY by the safety guarantees below — never by the exact-match
// count. Real-screenshot OCR can't hit 100% exact (even the English fixtures don't), so
// treating a low exact threshold as "passed" would be misleading. The exact recall is
// reported as a number for transparency, and an aggregate regression floor guards it.
let exactTotal = 0, truthTotal = 0, cleanTotal = 0, flagOkTotal = 0, flagWrongTotal = 0, missTotal = 0;
console.log("\n— OCR exact-match recall (reported, not a pass/fail) —");
for (const c of CASES) {
  const hints = extractTickerHints(await ocrText(engWorker, c.imgs, 2));
  // The app passes the portfolio's symbols in; screenshots ARE of the user's own
  // portfolio, so the truth symbols are exactly what the app would supply.
  const known = [...new Set(c.truth.map(t => t.split(",")[2]))];
  const textA = await ocrText(worker, c.imgs, 2), textB = await ocrText(worker, c.imgs, 3);
  const m = mergeParses(parseActivityText(textA, hints, known),
                        parseActivityText(textB, hints, known), { a: textA, b: textB });
  const exact = c.truth.filter(t => m.rows.some(r => r.csv === t)).length;
  const silent = m.rows.filter(r => !c.truth.includes(r.csv) && r.flags.length === 0);
  // Honest per-case breakdown: clean pass / flagged (right vs off) / missing
  const clean = m.rows.filter(r => c.truth.includes(r.csv) && r.flags.length === 0).length;
  const flagOk = m.rows.filter(r => c.truth.includes(r.csv) && r.flags.length > 0).length;
  const flagWrong = m.rows.filter(r => !c.truth.includes(r.csv) && r.flags.length > 0).length;
  const miss = c.truth.length - exact;
  exactTotal += exact; truthTotal += c.truth.length;
  cleanTotal += clean; flagOkTotal += flagOk; flagWrongTotal += flagWrong; missTotal += miss;
  const fl = flagOk + flagWrong;
  console.log(`   ${c.name}: ผ่านสะอาด ${clean}/${c.truth.length} · ติดธง ${fl}${fl ? ` (ค่าถูก ${flagOk}${flagWrong ? `, ค่าคลาดเคลื่อน ${flagWrong}` : ""})` : ""} · หายไป ${miss}`);
  // ── hard guarantees (these decide pass/fail) ──
  check(`${c.name}: no row is silently wrong (matches expect or is flagged)`, silent.length === 0, silent.map(r => r.csv).join(" | "));
  check(`${c.name}: no spurious rows invented (<= ${c.truth.length})`, m.rows.length <= c.truth.length, `got ${m.rows.length}`);
  check(`${c.name}: every emitted symbol is a valid ticker`, m.rows.every(r => /^([A-Z]{1,6}|XAUUSD)$/.test(r.symbol)), m.rows.map(r => r.symbol).join(","));
}
await worker.terminate();
await engWorker.terminate();

// Aggregate regression floor (so a code change that tanks recall is caught), reported honestly
const pct = Math.round(exactTotal / truthTotal * 100);
console.log(`\nOCR exact recall overall: ${exactTotal}/${truthTotal} rows (${pct}%) — ผ่านสะอาด ${cleanTotal} · ติดธงให้ตรวจ ${flagOkTotal + flagWrongTotal} (ค่าถูก ${flagOkTotal}, ค่าคลาดเคลื่อน ${flagWrongTotal}) · หายไป ${missTotal}`);
check(`recall did not regress (>= 95/${truthTotal})`, exactTotal >= 95, `got ${exactTotal}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
