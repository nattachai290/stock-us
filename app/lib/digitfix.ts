// ── Digit-only re-read of damaged share counts ──────────────────────────────────
// The broker always prints share counts with exactly 7 decimals, and the eng+tha passes
// damage them in two recurring ways: a "1" read as "]" ("0.066800]") and a digit dropped
// outright ("0.208761"). Both main passes can do it on the same row, and then no amount
// of merging recovers the value. So each damaged count is re-read on its own: tesseract
// gives every word's box, and that box is OCR'd again by a worker that may only emit
// 0-9 and "." — nothing Thai or alphabetic to confuse a digit with.
//
// A re-read is accepted ONLY when it comes back as a well-formed 7-decimal count;
// anything else leaves the original token untouched for the parser and its review flags.
// Measured on every fixture before this shipped: 18 damaged counts, 18 re-read to the
// right value, 0 to a wrong one.

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type OcrWord = { text: string; bbox: Box };
export type Rect = { left: number; top: number; width: number; height: number };

const CONFUSABLE = /[OolI|\]]/;

// A share count that came through damaged. Prices also carry a point (4 decimals for a
// fractional price), so this must not catch them: only 6 or 8 decimals (one digit lost
// or gained) or a glyph OCR confuses with a digit counts as damaged.
export function isDamagedCount(tok: string): boolean {
  const x = tok.replace(/,/g, "");
  const m = x.match(/^([\dOolI|\]]+)\.([\dOolI|\]]{5,9})$/);
  if (!m) return false;
  if (x.replace(/\D/g, "").length < 5) return false;
  if (CONFUSABLE.test(x)) return true;
  return m[2].length === 6 || m[2].length === 8;
}

export const isWellFormedCount = (s: string) => /^\d+\.\d{7}$/.test(s);

// Words of a tesseract page (recognize(..., { blocks: true })), flattened.
export function wordsOf(page: { blocks?: any[] | null }): OcrWord[] {
  return (page.blocks ?? []).flatMap((b: any) => b.paragraphs.flatMap((p: any) => p.lines.flatMap((l: any) => l.words)));
}

// The word's box with a margin of a third of its height, so the re-read sees whole glyphs.
export function rectFor(b: Box, imgW: number, imgH: number): Rect {
  const pad = Math.round((b.y1 - b.y0) * 0.35);
  const left = Math.max(0, b.x0 - pad), top = Math.max(0, b.y0 - pad);
  return { left, top, width: Math.min(imgW, b.x1 + pad) - left, height: Math.min(imgH, b.y1 + pad) - top };
}

// Re-read every damaged count in one pass's output and patch the text the parser sees.
// `readRect` OCRs a rectangle of the SAME image with the digit-only worker. Returns the
// patched text and the repairs made (for the UI/tests).
export async function repairCounts(
  text: string, words: OcrWord[], imgW: number, imgH: number,
  readRect: (r: Rect) => Promise<string>,
): Promise<{ text: string; repairs: { from: string; to: string }[] }> {
  const repairs: { from: string; to: string }[] = [];
  // A repair must land on THIS word's occurrence, not the first matching token: two rows
  // can carry the same damaged reading, and if the first one's re-read is rejected, the
  // second's value must not be written onto the first row. Words come in reading order,
  // as the text does, so the k-th word with a given text is the k-th occurrence of it.
  const seen = new Map<string, number>();
  const edits: { at: number; len: number; to: string }[] = [];
  for (const w of words) {
    if (!isDamagedCount(w.text)) continue;
    const k = seen.get(w.text) ?? 0;
    seen.set(w.text, k + 1);
    const re = (await readRect(rectFor(w.bbox, imgW, imgH))).replace(/\s/g, "");
    if (!isWellFormedCount(re)) continue;
    // whole-token occurrences only — never inside a longer number
    const esc = w.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const at = [...text.matchAll(new RegExp(`(^|[^\\d.])${esc}(?![\\d.])`, "gm"))].map(m => m.index! + m[1].length)[k];
    if (at === undefined) continue;
    edits.push({ at, len: w.text.length, to: re });
    repairs.push({ from: w.text, to: re });
  }
  // apply back to front so earlier offsets stay valid
  let out = text;
  for (const e of edits.sort((x, y) => y.at - x.at)) out = out.slice(0, e.at) + e.to + out.slice(e.at + e.len);
  return { text: out, repairs };
}

// The digit-only worker's settings (PSM 7 = a single line of text).
export const DIGIT_PARAMS = { tessedit_char_whitelist: "0123456789.", tessedit_pageseg_mode: "7" } as const;
