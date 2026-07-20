// Parser for OCR text of the broker app's Activity screen → tx-import CSV rows.
// Pure functions (no tesseract import here) so the parsing is unit-testable in Node.

export type OcrTxRow = {
  csv: string;            // "DD/MM/YYYY HH:mm,B,SYMBOL,qty,price" — same format importTxCSV accepts
  iso: string;            // for sorting oldest→first (FIFO import needs chronological order)
  side: "B" | "S";
  symbol: string;
  qty: number;
  qtyStr: string;         // raw OCR token — needed to count decimals (Number drops trailing zeros)
  price: number;
  priceStr: string;
  total?: number;         // the amount shown on the right in the screenshot
  currency?: string;      // USD rows can be cross-checked (price×qty≈total); THB can't (unknown FX rate)
  check: "ok" | "mismatch" | "unverified";
  isGold?: boolean;       // gold DCA rows use "Weight x oz" (4 decimals) & map to XAUUSD
  sideUncertain?: boolean;// Thai ซื้อ/ขาย was too garbled to read confidently — needs a look
  skip?: boolean;         // corporate-action block (split) — not a plain buy/sell, dropped
};

export type OcrParseResult = { rows: OcrTxRow[]; incomplete: number };

const MONTHS: Record<string, string> = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };

// Thai month abbreviations, keyed by their consonants with dots/spaces stripped
// (มิ.ย. → มิย). The broker also prints them on the date line.
const THAI_MON: Record<string, string> = { "มค":"01", "กพ":"02", "มีค":"03", "เมย":"04", "พค":"05", "มิย":"06", "กค":"07", "สค":"08", "กย":"09", "ตค":"10", "พย":"11", "ธค":"12" };
// Full Thai month names appear in the section headers ("มิถุนายน 2569")
const THAI_FULL_MON = /(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)/;
const despace = (s: string) => s.replace(/\s+/g, "");
const dedot = (s: string) => s.replace(/[.\s]/g, "");
// Thai screenshots print the Buddhist year, short ("69") or full ("2569"); English
// screenshots print the CE year (2026). Normalise everything to CE.
function toCEYear(y: string): number {
  const n = parseInt(y, 10);
  if (y.length <= 2) return 1957 + n; // "69" = 2569 BE = 2026 CE
  if (n >= 2500) return n - 543;      // 2569 BE → 2026 CE
  return n;                           // already CE
}

// OCR digit fixups applied only inside tokens we already believe are numbers
const numFix = (s: string) => s.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/,/g, "");
const toNum = (s: string) => parseFloat(numFix(s));

export function parseActivityText(text: string): OcrParseResult {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const rows: OcrTxRow[] = [];
  let incomplete = 0;

  type Draft = Partial<OcrTxRow>;
  let cur: Draft | null = null;

  const flush = () => {
    if (!cur) return;
    if (cur.skip) { cur = null; return; } // corporate action — dropped on purpose
    // A ticker that OCR mangled must not be emitted with a wrong symbol
    const cleanSym = cur.isGold || (cur.symbol && /^[A-Z]{1,6}$/.test(cur.symbol));
    if (cur.side && cleanSym && cur.qty && cur.price && cur.iso) {
      let check: OcrTxRow["check"] = "unverified";
      if (cur.currency === "USD" && cur.total) {
        const expect = cur.qty * cur.price;
        // fees make the shown total differ a little from price×qty
        check = Math.abs(expect - cur.total) <= Math.max(0.6, cur.total * 0.03) ? "ok" : "mismatch";
      }
      // Gold DCA (e.g. MTS-GOLD) is priced in USD/oz — same unit as the XAUUSD spot
      // source in /api/price — so map it there regardless of the broker's product name.
      const symbol = cur.isGold ? "XAUUSD" : cur.symbol!;
      const d = new Date(cur.iso);
      const csvDate = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
      rows.push({
        csv: `${csvDate},${cur.side},${symbol},${cur.qtyStr},${cur.priceStr}`,
        iso: cur.iso, side: cur.side, symbol,
        qty: cur.qty, qtyStr: cur.qtyStr || String(cur.qty),
        price: cur.price, priceStr: cur.priceStr || String(cur.price),
        total: cur.total, currency: cur.currency, check, isGold: cur.isGold,
        sideUncertain: cur.sideUncertain,
      });
    } else if (cur.side || cur.price || cur.qty) {
      incomplete++;
    }
    cur = null;
  };

  // Month section headers ("December 2025") sit between transaction blocks — treat
  // them as record boundaries so a missed/garbled "Buy XXX" header line can't make
  // the previous record absorb the next block's numbers.
  const MONTH_HEADER = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i;

  for (const line of lines) {
    if (MONTH_HEADER.test(line)) { flush(); continue; }
    const compact = despace(line);
    // Thai section header ("มิถุนายน 2569") — full month name + year, no tx content
    if (THAI_FULL_MON.test(compact) && /\d{4}/.test(line) && !/GOLD|oz|USD/i.test(line)) { flush(); continue; }

    // Corporate action ("CA - แตกหรือรวมหุ้น", i.e. a split) — the "CA" marker is Latin
    // and reliable. These map to +/- share adjustments that the FIFO importer treats
    // specially; rather than risk a bad row, mark the current block to be skipped so the
    // user imports the (rare) split by hand.
    if (/\bCA\b/.test(line) && (compact.includes("แตก") || compact.includes("รวม"))) { if (cur) cur.skip = true; }

    // New record starts at a Buy/Sell line: "Buy ARM", "Sell ARM" (symbol may touch: "BuyARM")
    const m = line.match(/\b(Buy|Sell)\s*([A-Z][A-Z0-9.\-]{0,9})\b/);
    if (m) {
      flush();
      cur = { side: m[1] === "Buy" ? "B" : "S", symbol: m[2].toUpperCase().replace(/\./g, "-") };
    } else {
      // Thai header line. Anchors are all Latin/structural, so they survive the noisy Thai:
      //  • gold: the product name contains GOLD
      //  • buy:  a "<total> บาท/USD" amount (only BUYS show a spent total → side B is
      //          structural, not from the noisy word)
      //  • sell: "<ticker> <shares> หุ้น" (share count; side S needs the ขาย word)
      // A ticker that OCR mangled into Thai simply won't match [A-Z]{1,6} → the block is
      // dropped (missing), never emitted with a wrong symbol.
      const goldHdr = line.match(/\b([A-Z]{2,}-?GOLD)\b/i);
      const anyTotal  = /[\d,OolI|]+\.\d{2}\s*(?:บ|USD|THB)/i.test(line); // a spent/received total → header
      const bahtTotal = /[\d,OolI|]+\.\d{2}\s*(?:บ|THB)/i.test(line);     // baht spent = a BUY, unambiguously
      const sellM = line.match(/\b([A-Z]{1,6})\b\s+(-?[\d.OolI|]{6,})\s*(?:ห|Ku|Au|Kn)/); // "ticker qty หุ้น" (sell)
      const tickerM = line.match(/\b([A-Z]{1,6})\b/); // uppercase-only — a Thai-mangled ticker won't match
      if (goldHdr || (anyTotal && tickerM) || sellM) {
        flush();
        const gold = !!goldHdr;
        // Side priority: the readable Thai word, else a baht total (definitely a buy). A USD
        // total is ambiguous (stock buy vs gold-sale proceeds), so if the word is unreadable
        // we flag rather than guess silently.
        let side: "B" | "S", uncertain = false;
        if (compact.includes("ขาย")) side = "S";
        else if (compact.includes("ซื้อ") || compact.includes("ือ")) side = "B";
        else if (bahtTotal && !sellM) side = "B";
        else { side = sellM ? "S" : "B"; uncertain = true; }
        cur = { side, symbol: gold ? "MTS-GOLD" : (tickerM ? tickerM[1] : sellM![1]).toUpperCase(), isGold: gold, sideUncertain: uncertain };
        if (sellM && !bahtTotal) { const v = toNum(sellM[2]); if (v > 0) { cur.qty = v; cur.qtyStr = numFix(sellM[2]); } }
      }
    }
    if (!cur) continue;

    // All fields are first-value-wins: within one block each label appears once, so a
    // second occurrence means the next block's header was missed — never overwrite.

    // Total + currency, e.g. "12.09 USD" / "399.74 THB" / "14,000.96 บาท"
    const t = line.match(/([\d,OolI|]+\.\d{2})\s*(USD|THB|บ\s*า\s*ท)/i);
    if (t && cur.total == null) { cur.total = toNum(t[1]); cur.currency = /บ/.test(t[2]) ? "THB" : t[2].toUpperCase(); }

    // "Executed Price 325.00"
    const p = line.match(/Executed\s*Price[\s:]*([\d.,OolI|]+)/i);
    if (p && cur.price == null) { const v = toNum(p[1]); if (v > 0) { cur.price = v; cur.priceStr = numFix(p[1]); } }

    // "3 Jul 2026 - 06:03:10 PM" (dash/en-dash; seconds optional)
    const dm = line.match(/(\d{1,2})\s+([A-Za-z]{3,4})\.?\s+(\d{4})\s*[-–—]\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
    if (dm && !cur.iso) {
      const mon = MONTHS[dm[2].slice(0, 3).toLowerCase()];
      if (mon) {
        let hh = parseInt(dm[4], 10);
        const ap = (dm[6] || "").toUpperCase();
        if (ap === "PM" && hh !== 12) hh += 12;
        if (ap === "AM" && hh === 12) hh = 0;
        cur.iso = `${dm[3]}-${mon}-${dm[1].padStart(2, "0")}T${String(hh).padStart(2, "0")}:${dm[5]}:00`;
      }
    }

    // Thai date: "24 มิ.ย. 69 - 08:42:13 น." (24h clock, Buddhist year). The executed
    // price sits on this same line before the day, so grab it here too.
    if (!cur.iso) {
      const td = line.match(/(\d{1,2})\s+([฀-๿.\s]+?)\s*(\d{2,4})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
      if (td) {
        const mon = THAI_MON[dedot(td[2])];
        if (mon) {
          cur.iso = `${toCEYear(td[3])}-${mon}-${td[1].padStart(2, "0")}T${td[4].padStart(2, "0")}:${td[5]}:00`;
          if (cur.price == null) {
            const pm = line.match(/([\d,OolI|]+\.\d{2})/); // the x,xxx.xx before the date
            if (pm) { const v = toNum(pm[1]); if (v > 0) { cur.price = v; cur.priceStr = numFix(pm[1]); } }
          }
        }
      }
    }

    // "Shares 0.0371384" (stocks) or "Weight 0.0029 oz" / "น้ำหนัก 0.0976 oz" (gold, 4dp).
    // The "oz" unit is Latin, so anchoring on it works regardless of label language.
    const s = line.match(/Shares[\s:]*([\d.,OolI|]+)/i);
    if (s && cur.qty == null) { const v = toNum(s[1]); if (v > 0) { cur.qty = v; cur.qtyStr = numFix(s[1]); } }
    const w = line.match(/([\d.,OolI|]+)\s*[o0]z\b/i);
    if (w && cur.qty == null) { const v = toNum(w[1]); if (v > 0) { cur.qty = v; cur.qtyStr = numFix(w[1]); cur.isGold = true; } }
    // Thai buy quantity on its own line ("จำนวนหุ้น 0.0128022"): a Thai-labelled line
    // ending in a 7-decimal number, with no ticker / total / date on it.
    if (cur.qty == null && !cur.isGold && !/[A-Z]{2,}/.test(line) && !/บ|USD|THB|:/.test(line)) {
      const jm = line.match(/([\d.OolI|]{7,})\s*$/);
      if (jm) { const v = toNum(jm[1]); if (v > 0) { cur.qty = v; cur.qtyStr = numFix(jm[1]); } }
    }
  }
  flush();

  rows.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
  return { rows, incomplete };
}

// ── Ensemble merge ─────────────────────────────────────────────────────────────
// The same image is OCR'd twice (2x and 3x upscale) — the two passes fail on
// different rows, and the broker always prints Shares with 7 decimals, so:
// prefer the reading with 7 decimals; flag when passes disagree or neither has 7.

export type MergedRow = OcrTxRow & { flags: string[] };
export type MergeResult = { rows: MergedRow[]; incomplete: number };

const decimals = (s: string) => (s.split(".")[1] || "").length;
const SHARE_DECIMALS = 7;

export function mergeParses(a: OcrParseResult, b: OcrParseResult): MergeResult {
  // Key on date+symbol (NOT side): the Thai side word is noisy, so two passes can
  // disagree on Buy/Sell for the same transaction — we reconcile side here rather than
  // emit two rows. A single symbol won't have two transactions at the same minute.
  const key = (r: OcrTxRow) => `${r.iso}|${r.symbol}`;
  const bMap = new Map(b.rows.map(r => [key(r), r]));
  const seen = new Set<string>();
  const rows: MergedRow[] = [];

  const finalize = (best: OcrTxRow, side: "B" | "S", flags: string[]) => {
    if (!best.isGold && decimals(best.qtyStr) !== SHARE_DECIMALS) flags.push(`ทศนิยมจำนวนหุ้นได้ ${decimals(best.qtyStr)} หลัก (ปกติ 7) — อาจอ่านตกหลัก`);
    if (best.check === "mismatch") flags.push("ราคา×จำนวน ไม่ตรงกับยอดรวมในรูป");
    const parts = best.csv.split(","); parts[1] = side; // csv was built with best.side; apply the resolved one
    rows.push({ ...best, side, csv: parts.join(","), flags });
  };

  for (const ra of a.rows) {
    const k = key(ra);
    seen.add(k);
    const rb = bMap.get(k);
    const flags: string[] = [];

    // Resolve side: prefer the pass that read ซื้อ/ขาย confidently; flag any disagreement.
    let side = ra.side;
    if (!rb) {
      if (ra.sideUncertain) flags.push("อ่านชนิด ซื้อ/ขาย ไม่ชัด — ตรวจกับรูป");
    } else {
      if (ra.side !== rb.side) {
        side = (ra.sideUncertain && !rb.sideUncertain) ? rb.side : ra.side;
        flags.push("อ่านชนิด ซื้อ/ขาย ไม่ชัด — ตรวจกับรูป");
      } else if (ra.sideUncertain && rb.sideUncertain) {
        flags.push("อ่านชนิด ซื้อ/ขาย ไม่ชัด — ตรวจกับรูป");
      }
    }

    if (!rb) { flags.push("เห็นในรอบ OCR เดียว — ตรวจกับรูป"); finalize(ra, side, flags); continue; }

    // Resolve qty/price: the reading whose price×qty matches the printed USD total wins
    // (arithmetic can't lie); else prefer the 7-decimal Shares read.
    let best = ra;
    if (ra.qtyStr !== rb.qtyStr || ra.priceStr !== rb.priceStr) {
      const aUsd = ra.check === "ok", bUsd = rb.check === "ok";
      if (aUsd !== bUsd) {
        best = aUsd ? ra : rb;
      } else {
        if (ra.qtyStr !== rb.qtyStr) {
          const aOk = decimals(ra.qtyStr) === SHARE_DECIMALS;
          const bOk = decimals(rb.qtyStr) === SHARE_DECIMALS;
          if (aOk && !bOk) best = ra;
          else if (bOk && !aOk) best = rb;
          else { best = aOk ? ra : rb; if (!ra.isGold && !rb.isGold) flags.push(`จำนวนหุ้นสองรอบไม่ตรงกัน (${ra.qtyStr} / ${rb.qtyStr})`); }
        }
        if (ra.priceStr !== rb.priceStr) flags.push(`ราคาสองรอบไม่ตรงกัน (${ra.priceStr} / ${rb.priceStr})`);
      }
    }
    finalize(best, side, flags);
  }
  // rows the 2nd pass found that the 1st missed entirely
  for (const rb of b.rows) {
    if (seen.has(key(rb))) continue;
    const flags = ["เห็นในรอบ OCR เดียว — ตรวจกับรูป"];
    if (rb.sideUncertain) flags.push("อ่านชนิด ซื้อ/ขาย ไม่ชัด — ตรวจกับรูป");
    finalize(rb, rb.side, flags);
  }

  rows.sort((x, y) => new Date(x.iso).getTime() - new Date(y.iso).getTime());
  return { rows, incomplete: Math.max(a.incomplete, b.incomplete) };
}
