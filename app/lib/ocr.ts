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
  symbolFromHint?: boolean;// ticker came from the eng-only rescue pass — flag for review
  symbolHintMismatch?: string;// eng pass read a DIFFERENT ticker for this row — flag for review
  symbolCorrected?: string;// what OCR actually read, before the portfolio-whitelist fix
  sideFromTotal?: boolean; // side B inferred from a Thai total-style header (internal)
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
// OCR renderings of Thai month abbreviations that degraded into Latin/digits, mapped
// back. Each key is unambiguous: only one month fits the surviving glyph shapes
// (ก.พ→"AW" is the only ก-then-พ month; มิ.ย→"09" the only ม-then-ย; ก.ค→"nA"/"คค";
// ต.ค→"๓ค"/"ต๓ค" — the ต glyph misread as the Thai digit ๓, either replacing it or
// appearing alongside it — is the only ต-then-ค month).
const DEGRADED_MON: Record<string, string> = { aw: "02", "09": "06", na: "07", "คค": "07", "๓ค": "10", "ต๓ค": "10" };
// Stray combining vowels/tone marks OCR injects mid-abbreviation ("พ.ุย." → พย);
// none of the real abbreviation keys use these marks, so stripping them is lossless.
const monKey = (s: string) => dedot(s).replace(/[ุู่้๊๋็์ํๆ]/g, "");
const thaiMonth = (tok: string): string | undefined => {
  const k = monKey(tok);
  return THAI_MON[k] ?? DEGRADED_MON[k.toLowerCase()];
};
// Thai screenshots print the Buddhist year, short ("69") or full ("2569"); English
// screenshots print the CE year (2026). Normalise everything to CE.
function toCEYear(y: string): number {
  const n = parseInt(y, 10);
  if (y.length <= 2) return 1957 + n; // "69" = 2569 BE = 2026 CE
  if (n >= 2500) return n - 543;      // 2569 BE → 2026 CE
  return n;                           // already CE
}

// OCR digit fixups applied only inside tokens we already believe are numbers.
// "]" is a misread "1"; a number has exactly one decimal point, so extra dots
// ("2,.069.22") are separator noise — keep the last dot only.
const numFix = (s: string) => {
  let t = s.replace(/[Oo]/g, "0").replace(/[lI|\]]/g, "1").replace(/,/g, "");
  const i = t.lastIndexOf(".");
  if (i >= 0) t = t.slice(0, i).replace(/\./g, "") + t.slice(i);
  return t;
};
const toNum = (s: string) => parseFloat(numFix(s));
// A "]" in a share count is either a misread trailing 1 ("0.588568]") or inserted
// noise ("0.144660]1") — the broker always prints dp decimals, so pick the variant
// that lands on exactly dp.
const qtyFix = (s: string, dp: number) => {
  if (s.includes("]")) {
    for (const v of [s.replace(/\]/g, "1"), s.replace(/\]/g, "")]) {
      const f = numFix(v);
      if ((f.split(".")[1] || "").length === dp) return f;
    }
  }
  return numFix(s);
};
// Currency/marker words that match the ticker shape but are never tickers
const NOT_TICKERS = new Set(["USD", "THB", "DCA", "CA", "GOLD", "OZ", "AM", "PM"]);

// True when a and b differ by exactly one edit (substitution, insertion or deletion).
// Used for the portfolio-whitelist fix: OCR reading "IPR" when the portfolio holds
// IIPR (double-I merged into one glyph) is a 1-edit miss.
const editDist1 = (a: string, b: string): boolean => {
  if (a === b) return false;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  if (t.length - s.length > 1) return false;
  if (s.length === t.length) {
    let d = 0;
    for (let i = 0; i < s.length; i++) if (s[i] !== t[i]) d++;
    return d === 1;
  }
  let i = 0, j = 0, skipped = false;
  while (i < s.length && j < t.length) {
    if (s[i] === t[j]) { i++; j++; }
    else if (!skipped) { skipped = true; j++; }
    else return false;
  }
  return true;
};

// ── eng-only rescue pass ───────────────────────────────────────────────────────
// The eng+tha passes sometimes render a Latin ticker as Thai glyphs (IVV → "เง"),
// while an English-only pass reads the ticker fine but mangles the Thai words.
// Extract (share-count → ticker) pairs from the eng-only text: the broker prints
// share counts with 7 decimals, so the count uniquely identifies its row and lets
// the main parse adopt the eng reading for blocks whose ticker it couldn't read.
export function extractTickerHints(text: string): Record<string, string> {
  const hints: Record<string, string> = {};
  const clash = new Set<string>();
  const add = (q: string, t: string) => {
    const k = numFix(q);
    if (clash.has(k)) return;
    if (hints[k] && hints[k] !== t) { delete hints[k]; clash.add(k); return; } // ambiguous → unusable
    hints[k] = t;
  };
  const qty7 = (l: string) => l.match(/(\d+\.[\d\]]{7})(?!\d)/); // 7-decimal count ("]" = misread 1)
  let pending: string | null = null, ttl = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Executed-price/date lines ("... 175.32 26 A.W. 69 - 21:46:06") are not headers —
    // the mangled Thai label can shed uppercase junk that must not be taken as a ticker.
    const dateLine = /[-–—]\s*\d{1,2}[:.]\d{2}/.test(line);
    let ticker: string | null = null;
    if (!dateLine) for (const m of line.matchAll(/\b([A-Z]{2,6})\b/g)) if (!NOT_TICKERS.has(m[1])) { ticker = m[1]; break; }
    const q = qty7(line);
    if (ticker && q) { add(q[1], ticker); pending = null; continue; }        // sell header: ticker + count
    if (ticker && /\d+\.\d{2}(?!\d)/.test(line)) { pending = ticker; ttl = 3; continue; } // buy header: ticker + total
    if (pending && ttl-- > 0) { if (q) { add(q[1], pending); pending = null; } } // count on a following line
    else if (!dateLine) pending = null;
  }
  return hints;
}

export function parseActivityText(text: string, hints?: Record<string, string>, known?: string[]): OcrParseResult {
  const knownSet = new Set((known ?? []).map(s => s.toUpperCase()));
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const rows: OcrTxRow[] = [];
  let incomplete = 0;

  type Draft = Partial<OcrTxRow>;
  let cur: Draft | null = null;

  const flush = () => {
    if (!cur) return;
    if (cur.skip) { cur = null; return; } // corporate action — dropped on purpose
    // The "Thai total-header = buy" inference only holds for stocks; if the block
    // turned out to be gold (an oz weight line appeared, even with the product name
    // mangled), a USD total could be sale proceeds — downgrade to uncertain.
    if (cur.sideFromTotal && cur.isGold && cur.currency !== "THB") cur.sideUncertain = true;
    // eng-rescue: when the main pass couldn't read this block's ticker, adopt the
    // eng-only pass's reading for this exact share count (flagged in mergeParses).
    // A ticker the main pass DID read cleanly is never overridden — the eng pass can
    // shed uppercase junk — but a disagreement is surfaced as a review flag.
    if (!cur.isGold && cur.qtyStr && hints) {
      const hint = hints[cur.qtyStr];
      const valid = cur.symbol && /^[A-Z]{1,6}$/.test(cur.symbol) && !NOT_TICKERS.has(cur.symbol);
      if (hint && !valid) {
        cur.symbol = hint;
        // A rescued name the user actually holds has two independent confirmations
        // (the 7-decimal share count matched AND the portfolio contains it) — clean.
        // A rescued name NOT in the portfolio keeps the review flag.
        cur.symbolFromHint = !knownSet.has(hint);
      }
      else if (hint && valid && hint !== cur.symbol) cur.symbolHintMismatch = hint;
    }
    // Portfolio-whitelist fix: a read ticker the user doesn't hold, one edit away from
    // exactly ONE symbol they do hold, is almost certainly that symbol (OCR merged or
    // swapped a glyph). Ambiguity (2+ candidates) leaves the reading alone; the fix is
    // always flagged for review in mergeParses — never silent.
    if (!cur.isGold && cur.symbol && knownSet.size && !knownSet.has(cur.symbol)) {
      const cands = [...knownSet].filter(k => editDist1(cur!.symbol!, k));
      if (cands.length === 1) { cur.symbolCorrected = cur.symbol; cur.symbol = cands[0]; }
    }
    // A ticker that OCR mangled must not be emitted with a wrong symbol
    const cleanSym = cur.isGold || (cur.symbol && /^[A-Z]{1,6}$/.test(cur.symbol) && !NOT_TICKERS.has(cur.symbol));
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
        sideUncertain: cur.sideUncertain, symbolFromHint: cur.symbolFromHint,
        symbolHintMismatch: cur.symbolHintMismatch, symbolCorrected: cur.symbolCorrected,
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
      let sellM = line.match(/\b([A-Z]{1,6})\b\s+(-?[\d.OolI|\]]{6,})\s*(?:ห|Ku|Au|Kn)/); // "ticker qty หุ้น" (sell)
      if (sellM && NOT_TICKERS.has(sellM[1])) sellM = null;
      // uppercase-only — a Thai-mangled ticker won't match; skip currency/marker words
      // so "ซื้อ <mangled> 1.60 USD" can't emit USD as the symbol
      let ticker: string | null = null;
      for (const tm of line.matchAll(/\b([A-Z]{1,6})\b/g)) {
        if (!NOT_TICKERS.has(tm[1])) { ticker = tm[1]; break; }
      }
      const sellWord = compact.includes("ขาย") || compact.includes("ยาย") || compact.includes("บาย");
      const buyWord = compact.includes("ซื้อ") || compact.includes("ือ");
      // Share-count + หุ้น unit with an unreadable ticker ("ยาย เง 0.0045730 หุ้น") —
      // still a header; the eng-rescue pass may recover the symbol at flush time.
      const qtyUnit = !sellM && (sellWord || buyWord) ? line.match(/(-?[\d.OolI|\]]{6,})\s*(?:ห|Ku|Au|Kn)/) : null;
      // "ยอดที่ได้รับคืน X USD" (amount refunded) is an auxiliary detail line on a
      // sell-BY-WEIGHT gold row (header shows the oz sold, not a money total; this
      // line gives the USD equivalent afterward) — it carries a total-shaped number
      // but is never itself a header, so it must not open (and thereby prematurely
      // flush) a new record. Field-extraction below still runs on it as normal.
      const isRefundLine = compact.includes("ได้รับคืน");
      if (!isRefundLine && (goldHdr || anyTotal || sellM || qtyUnit)) {
        flush();
        const gold = !!goldHdr;
        // Side priority: the readable Thai word (ยาย/บาย are common OCR renderings of
        // ขาย), else a baht total (definitely a buy). A USD total is ambiguous (a buy can
        // be USD-funded; a gold sale shows USD proceeds), so if the word is unreadable we
        // flag rather than guess silently.
        let side: "B" | "S", uncertain = false, fromTotal = false;
        if (sellWord) side = "S";
        else if (buyWord) side = "B";
        else if (bahtTotal && !sellM) side = "B";
        else if (anyTotal && !sellM && !gold && /[฀-๿]/.test(line)) {
          // Thai STOCK layout: a sell header prints "<qty> หุ้น", never a money total —
          // so a total-style Thai header is structurally a BUY even when USD-funded.
          // (English headers do print totals on sells → Thai-glyph guard; gold sells
          // print USD proceeds → if the block turns out gold, flush downgrades this.)
          side = "B"; fromTotal = true;
        }
        else { side = sellM ? "S" : "B"; uncertain = true; }
        cur = { side, symbol: gold ? "MTS-GOLD" : (ticker ?? sellM?.[1])?.toUpperCase(), isGold: gold, sideUncertain: uncertain, sideFromTotal: fromTotal };
        const qtyTok = sellM ? sellM[2] : qtyUnit?.[1];
        if (qtyTok && !bahtTotal) { const f = qtyFix(qtyTok, 7); const v = parseFloat(f); if (v > 0) { cur.qty = v; cur.qtyStr = f; } }
      } else if (cur && cur.price != null && (compact.includes("จริง") || /Executed\s*Price/i.test(line))) {
        // A second executed-price line while the open block already has its price means
        // the next block's header was too mangled to detect — flush so the open block
        // can't absorb the stranger's numbers (its own line then belongs to no record).
        flush();
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
    // price sits on this same line before the day, so grab it here too. The time
    // separator tolerates a misread dot ("17.14:24"); "]" next to a digit is a 1.
    if (!cur.iso) {
      const numLine = line.replace(/\](?=\d)/g, "1").replace(/(?<=\d)\]/g, "1");
      let iso: string | null = null;
      let pricePrefix = ""; // only the part of the line BEFORE the date may hold the price
      const td = numLine.match(/(\d{1,2})\s+([฀-๿.\s]+?)\s*(\d{2,4})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/);
      if (td) {
        const mon = thaiMonth(td[2]);
        if (mon) {
          iso = `${toCEYear(td[3])}-${mon}-${td[1].padStart(2, "0")}T${td[4].padStart(2, "0")}:${td[5]}:00`;
          pricePrefix = numLine.slice(0, td.index);
        }
      }
      if (!iso) {
        // Degraded fallback: the month glyphs collapsed into Latin/digits ("26 0.9. 69",
        // "9 n.A. 69") or the day did ("| ก.ค. 69"), which the strict pattern can't see.
        // Anchor on "- hh:mm", then walk the tokens before it: year, month token(s),
        // then a 1-2 char day. Only accepted when the month maps unambiguously.
        const t = numLine.match(/^(.*?)[-–—]\s*(\d{1,2})[:.](\d{2})/);
        if (t) {
          const toks = t[1].trim().split(/\s+/);
          const year = toks.pop();
          if (year && /^\d{2,4}$/.test(year)) {
            const monToks: string[] = [];
            let day = "";
            while (toks.length && monToks.length <= 6) {
              const tk = toks.pop()!;
              if (/^[\d|lI]{1,2}$/.test(tk) && monToks.length) { day = numFix(tk); break; }
              monToks.unshift(tk);
            }
            const mon = day ? thaiMonth(monToks.join("")) : undefined;
            const d = parseInt(day, 10), hh = parseInt(t[2], 10), mm = parseInt(t[3], 10);
            if (mon && d >= 1 && d <= 31 && hh <= 23 && mm <= 59) {
              iso = `${toCEYear(year)}-${mon}-${day.padStart(2, "0")}T${t[2].padStart(2, "0")}:${t[3]}:00`;
              pricePrefix = toks.join(" "); // what's left before the day token
            }
          }
        }
      }
      if (iso) {
        cur.iso = iso;
        if (cur.price == null) {
          // The executed price sits before the date; keep ALL its decimals (broker shows
          // 2 or 4, e.g. 48.35 / 449.8440). Searching only the pre-date prefix means a
          // mangled price can never be silently replaced by the time digits. A thousands
          // separator read as a space ("3 130.88") is joined first.
          const pm = pricePrefix.replace(/(\d)\s+(?=\d{3}\.\d{2})/g, "$1").match(/([\d,.OolI|]+\.\d{2,})/);
          if (pm) { const v = toNum(pm[1]); if (v > 0) { cur.price = v; cur.priceStr = numFix(pm[1]); } }
        }
      }
    }

    // "Shares 0.0371384" (stocks) or "Weight 0.0029 oz" / "น้ำหนัก 0.0976 oz" (gold, 4dp).
    // The "oz" unit is Latin, so anchoring on it works regardless of label language.
    // OCR sometimes renders "oz" as the Thai digit zero + a stray digit ("๐ 7", "๐ 2") —
    // the Thai glyph for ๐ resembles "o", and the accompanying digit is noise from "z".
    const setQty = (raw: string, dp: number) => {
      const f = qtyFix(raw, dp);
      const v = parseFloat(f);
      if (v > 0) { cur!.qty = v; cur!.qtyStr = f; }
    };
    const s = line.match(/Shares[\s:]*([\d.,OolI|\]]+)/i);
    if (s && cur.qty == null) setQty(s[1], 7);
    const w = line.match(/([\d.,OolI|\]]+)\s*(?:[o0]z\b|๐\s?\d)/i);
    if (w && cur.qty == null) { setQty(w[1], 4); if (cur.qty != null) cur.isGold = true; }
    // Thai buy quantity on its own line ("จำนวนหุ้น 0.0128022"): a Thai-labelled line
    // ending in a 7-decimal number, with no ticker / total / date on it.
    if (cur.qty == null && !cur.isGold && !/[A-Z]{2,}/.test(line) && !/บ|USD|THB|:/.test(line)) {
      const jm = line.match(/([\d.OolI|\]]{7,})\s*$/);
      if (jm) setQty(jm[1], 7);
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

// A row only ONE pass managed to parse can still be confirmed against the OTHER
// pass's raw text: if that text has a line carrying the row's price AND its hh:mm
// (the executed-price line — a misassociated price would sit next to a different
// time), with the share count on a nearby line, then all three numbers existed in
// the other pass's view too and its parse merely tripped on layout noise.
function confirmedInText(r: OcrTxRow, text?: string): boolean {
  if (!text) return false;
  const hhmm = r.csv.slice(11, 16);
  const priceKey = r.priceStr.replace(/\./g, "");
  const qtyKey = r.qtyStr.replace(/\./g, "");
  const lines = text.split("\n").map(l => l.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/[,\s]/g, ""));
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(hhmm) || !lines[i].replace(/\./g, "").includes(priceKey)) continue;
    for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++)
      if (lines[j].replace(/\./g, "").includes(qtyKey)) return true;
  }
  // Second path: the header line carries symbol + share count together (a sell
  // header) with the price on one of the next lines — covers a pass whose date/time
  // collapsed entirely while the header itself stayed readable.
  const symKey = r.symbol.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(symKey) || !lines[i].replace(/\./g, "").includes(qtyKey)) continue;
    for (let j = i; j <= Math.min(lines.length - 1, i + 2); j++)
      if (lines[j].replace(/\./g, "").includes(priceKey)) return true;
  }
  return false;
}

const decimals = (s: string) => (s.split(".")[1] || "").length;
const SHARE_DECIMALS = 7;

export function mergeParses(a: OcrParseResult, b: OcrParseResult, texts?: { a?: string; b?: string }): MergeResult {
  // Key on date+symbol (NOT side): the Thai side word is noisy, so two passes can
  // disagree on Buy/Sell for the same transaction — we reconcile side here rather than
  // emit two rows. A single symbol won't have two transactions at the same minute.
  const key = (r: OcrTxRow) => `${r.iso}|${r.symbol}`;
  const bMap = new Map(b.rows.map(r => [key(r), r]));
  const seen = new Set<string>();
  const rows: MergedRow[] = [];

  const finalize = (best: OcrTxRow, side: "B" | "S", flags: string[]) => {
    if (best.symbolFromHint) flags.push("ชื่อหุ้นอ่านจากรอบภาษาอังกฤษ — ตรวจกับรูป");
    if (best.symbolHintMismatch) flags.push(`รอบภาษาอังกฤษอ่านชื่อหุ้นเป็น ${best.symbolHintMismatch} — ตรวจกับรูป`);
    if (best.symbolCorrected) flags.push(`OCR อ่านได้ "${best.symbolCorrected}" — แก้เป็น ${best.symbol} ตามหุ้นในพอร์ต ตรวจกับรูป`);
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

    if (!rb) {
      if (!confirmedInText(ra, texts?.b)) flags.push("เห็นในรอบ OCR เดียว — ตรวจกับรูป");
      finalize(ra, side, flags); continue;
    }

    // Resolve qty/price: the reading whose price×qty matches the printed USD total wins
    // (arithmetic can't lie); else prefer the 7-decimal Shares read.
    let best = ra;
    if (ra.qtyStr === rb.qtyStr && ra.priceStr === rb.priceStr) {
      // Same numbers in both passes, but one pass misread the printed TOTAL (a leading
      // digit drops easily: "11.92" → "1.92") — trust the pass where arithmetic agrees
      // rather than flagging a row that is actually consistent.
      if (ra.check !== "ok" && rb.check === "ok") best = rb;
    } else {
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
    const flags: string[] = [];
    if (!confirmedInText(rb, texts?.a)) flags.push("เห็นในรอบ OCR เดียว — ตรวจกับรูป");
    if (rb.sideUncertain) flags.push("อ่านชนิด ซื้อ/ขาย ไม่ชัด — ตรวจกับรูป");
    finalize(rb, rb.side, flags);
  }

  rows.sort((x, y) => new Date(x.iso).getTime() - new Date(y.iso).getTime());
  // "incomplete" must count transactions MISSING FROM THE FINAL output, not per-pass
  // parse failures: a block one pass couldn't finish is often recovered by the other,
  // and must not be reported as unread. Each pass detected (rows + incomplete) record
  // starts; the pass that saw the most is the best estimate of the true transaction
  // count, and anything beyond the merged rows is what genuinely didn't come through.
  const starts = Math.max(a.rows.length + a.incomplete, b.rows.length + b.incomplete);
  return { rows, incomplete: Math.max(0, starts - rows.length) };
}
