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
};

export type OcrParseResult = { rows: OcrTxRow[]; incomplete: number };

const MONTHS: Record<string, string> = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };

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
    if (cur.side && cur.symbol && cur.qty && cur.price && cur.iso) {
      let check: OcrTxRow["check"] = "unverified";
      if (cur.currency === "USD" && cur.total) {
        const expect = cur.qty * cur.price;
        // fees make the shown total differ a little from price×qty
        check = Math.abs(expect - cur.total) <= Math.max(0.6, cur.total * 0.03) ? "ok" : "mismatch";
      }
      const d = new Date(cur.iso);
      const csvDate = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
      rows.push({
        csv: `${csvDate},${cur.side},${cur.symbol},${cur.qtyStr},${cur.priceStr}`,
        iso: cur.iso, side: cur.side, symbol: cur.symbol,
        qty: cur.qty, qtyStr: cur.qtyStr || String(cur.qty),
        price: cur.price, priceStr: cur.priceStr || String(cur.price),
        total: cur.total, currency: cur.currency, check,
      });
    } else if (cur.side || cur.price || cur.qty) {
      incomplete++;
    }
    cur = null;
  };

  for (const line of lines) {
    // New record starts at a Buy/Sell line: "Buy ARM", "Sell ARM" (symbol may touch: "BuyARM")
    const m = line.match(/\b(Buy|Sell)\s*([A-Z][A-Z0-9.\-]{0,9})\b/);
    if (m) {
      flush();
      cur = { side: m[1] === "Buy" ? "B" : "S", symbol: m[2].toUpperCase().replace(/\./g, "-") };
    }
    if (!cur) continue;

    // Total + currency, e.g. "12.09 USD" / "399.74 THB" (often on the Buy/Sell line itself)
    const t = line.match(/([\d,OolI|]+\.\d{2})\s*(USD|THB)/i);
    if (t && cur.total == null) { cur.total = toNum(t[1]); cur.currency = t[2].toUpperCase(); }

    // "Executed Price 325.00"
    const p = line.match(/Executed\s*Price[\s:]*([\d.,OolI|]+)/i);
    if (p) { const v = toNum(p[1]); if (v > 0) { cur.price = v; cur.priceStr = numFix(p[1]); } }

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

    // "Shares 0.0371384"
    const s = line.match(/Shares[\s:]*([\d.,OolI|]+)/i);
    if (s) { const v = toNum(s[1]); if (v > 0) { cur.qty = v; cur.qtyStr = numFix(s[1]); } }
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
  const key = (r: OcrTxRow) => `${r.iso}|${r.side}|${r.symbol}`;
  const bMap = new Map(b.rows.map(r => [key(r), r]));
  const seen = new Set<string>();
  const rows: MergedRow[] = [];

  for (const ra of a.rows) {
    const k = key(ra);
    seen.add(k);
    const rb = bMap.get(k);
    const flags: string[] = [];
    let best = ra;

    if (!rb) {
      flags.push("เห็นในรอบ OCR เดียว — ตรวจกับรูป");
    } else {
      // qty: prefer the pass whose token has the expected 7 decimals
      if (ra.qtyStr !== rb.qtyStr) {
        const aOk = decimals(ra.qtyStr) === SHARE_DECIMALS;
        const bOk = decimals(rb.qtyStr) === SHARE_DECIMALS;
        if (aOk && !bOk) best = ra;
        else if (bOk && !aOk) best = rb;
        else { best = aOk ? ra : rb; flags.push(`จำนวนหุ้นสองรอบไม่ตรงกัน (${ra.qtyStr} / ${rb.qtyStr})`); }
      }
      if (ra.priceStr !== rb.priceStr) flags.push(`ราคาสองรอบไม่ตรงกัน (${ra.priceStr} / ${rb.priceStr})`);
    }

    if (decimals(best.qtyStr) !== SHARE_DECIMALS) flags.push(`ทศนิยมจำนวนหุ้นได้ ${decimals(best.qtyStr)} หลัก (ปกติ 7) — อาจอ่านตกหลัก`);
    if (best.check === "mismatch") flags.push("ราคา×จำนวน ไม่ตรงกับยอดรวมในรูป");

    rows.push({ ...best, flags });
  }
  // rows the 2nd pass found that the 1st missed entirely
  for (const rb of b.rows) {
    if (seen.has(key(rb))) continue;
    const flags = ["เห็นในรอบ OCR เดียว — ตรวจกับรูป"];
    if (decimals(rb.qtyStr) !== SHARE_DECIMALS) flags.push(`ทศนิยมจำนวนหุ้นได้ ${decimals(rb.qtyStr)} หลัก (ปกติ 7) — อาจอ่านตกหลัก`);
    if (rb.check === "mismatch") flags.push("ราคา×จำนวน ไม่ตรงกับยอดรวมในรูป");
    rows.push({ ...rb, flags });
  }

  rows.sort((x, y) => new Date(x.iso).getTime() - new Date(y.iso).getTime());
  return { rows, incomplete: Math.max(a.incomplete, b.incomplete) };
}
