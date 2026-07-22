"use client";
import { useRef, useState } from "react";
import { parseActivityText, mergeParses, extractTickerHints, extractMonthHints, type MergeResult } from "../lib/ocr";
import { grayscaleInvert, resizeBilinear } from "../lib/preprocess";
import { btnGhost, btnPrimary } from "../lib/ui";

// Upload broker-app Activity screenshots → OCR (tesseract.js, fully client-side,
// assets self-hosted under /public/tesseract) → tx-import CSV rows appended into
// the existing Import textarea for review. Each image is OCR'd twice (2x and 3x
// upscale, eng+tha) and the passes are merged — see mergeParses in lib/ocr.ts —
// plus a third eng-ONLY pass whose job is rescuing Latin tickers the Thai model
// renders as Thai glyphs (see extractTickerHints). Nothing is imported
// automatically; the user reviews the textarea and presses นำเข้า as usual.
// Map a row's review flags to the CSV columns they concern, so the import editor can tint
// just those fields. CSV is `date,side,symbol,qty,price` → columns 0..4. A flag with no
// specific field ("เห็นในรอบ OCR เดียว" — the whole row came from one pass) points at the
// value fields symbol/qty/price, the things a reviewer re-checks against the screenshot.
const flagColumns = (flags: string[]): number[] => {
  const cols = new Set<number>();
  for (const f of flags) {
    if (f.includes("เดาเป็นเดือน")) cols.add(0);                       // month in the date
    if (f.includes("ซื้อ/ขาย")) cols.add(1);                          // side
    if (f.includes("ชื่อหุ้น") || f.includes("หุ้นในพอร์ต")) cols.add(2); // symbol
    if (f.includes("จำนวน")) cols.add(3);                             // amount / shares
    if (f.includes("ราคา")) cols.add(4);                             // price
    if (f.includes("เห็นในรอบ OCR เดียว")) { cols.add(2); cols.add(3); cols.add(4); }
  }
  return [...cols].sort((a, b) => a - b);
};

export default function OcrImport({ onAppend, knownSymbols }: { onAppend: (csv: string, flaggedFields: { csv: string; cols: number[] }[]) => void; knownSymbols?: string[] }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");     // "รูปที่ x/y" label (no round numbers shown)
  const [pct, setPct] = useState<number | null>(null); // 0..100 for the progress bar; null = no bar
  const [result, setResult] = useState<MergeResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Grayscale+invert at native size (white-on-dark → black-on-white), then a
  // DETERMINISTIC bilinear upscale from lib/preprocess — shared verbatim with the
  // test harness, so the app and CI feed tesseract identical pixels on the same
  // image regardless of browser engine. Canvas is used only to decode/encode.
  const preprocess = async (file: File, scale: number): Promise<Blob> => {
    const bmp = await createImageBitmap(file);
    const c1 = document.createElement("canvas");
    c1.width = bmp.width; c1.height = bmp.height;
    const x1 = c1.getContext("2d")!;
    x1.drawImage(bmp, 0, 0);
    const id = x1.getImageData(0, 0, c1.width, c1.height);
    grayscaleInvert(id.data);
    const r = resizeBilinear(id.data, c1.width, c1.height, scale);
    const c2 = document.createElement("canvas");
    c2.width = r.width; c2.height = r.height;
    c2.getContext("2d")!.putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
    return new Promise((res, rej) => c2.toBlob(b => b ? res(b) : rej(new Error("canvas.toBlob failed")), "image/png"));
  };

  const run = async (files: FileList) => {
    if (!files.length) return;
    setBusy(true); setResult(null); setPct(0); setProgress("กำลังโหลดตัวอ่าน OCR (ครั้งแรกอาจใช้เวลาสักครู่)...");
    try {
      const { createWorker } = await import("tesseract.js");
      const mkWorker = (lang: string) => createWorker(lang, 1, {
        workerPath: "/tesseract/worker.min.js", corePath: "/tesseract", langPath: "/tesseract", gzip: true,
      });
      const list = Array.from(files);
      const N = list.length;

      // Two eng+tha workers so the 2x and 3x upscales of the SAME image are recognised
      // concurrently instead of one after the other — halves the main-pass wall time. Images
      // are still processed one at a time (peak 2 workers, bounded memory), so "รูปที่ x/y"
      // stays meaningful. eng+tha: the broker app can be Thai (ขาย/ซื้อ, Thai months, Buddhist
      // year); Thai data doesn't hurt English screenshots and numbers/oz/USD stay Latin.
      const [w2, w3] = await Promise.all([mkWorker("eng+tha"), mkWorker("eng+tha")]);
      const texts: Record<number, string> = { 2: "", 3: "" };
      for (let i = 0; i < N; i++) {
        setProgress(`กำลังอ่านรูปที่ ${i + 1}/${N}`); setPct(Math.round((i / N) * 100));
        const [b2, b3] = await Promise.all([preprocess(list[i], 2), preprocess(list[i], 3)]);
        const [r2, r3] = await Promise.all([w2.recognize(b2), w3.recognize(b3)]);
        texts[2] += r2.data.text + "\n";
        texts[3] += r3.data.text + "\n";
        setPct(Math.round(((i + 1) / N) * 100));
      }
      await Promise.all([w2.terminate(), w3.terminate()]);
      // The two eng+tha passes alone often read everything. The specialist single-language
      // passes below only ever help blocks the main passes couldn't finish (a Thai-mangled
      // ticker → dropped → incomplete; a Latin-rendered month → inferred). So parse the
      // main passes first and run the specialists ONLY when there's something for them to
      // fix — clean screenshots (English, or Thai that OCR'd well) skip them and finish in
      // two passes instead of four.
      const parseMain = (h?: Record<string, string>, mh?: Record<string, { mon: string; year: string }>, extra?: string[]) =>
        mergeParses(parseActivityText(texts[2], h, knownSymbols, mh),
                    parseActivityText(texts[3], h, knownSymbols, mh), { a: texts[2], b: texts[3], extra });
      let merged = parseMain();
      // Run the specialist passes when there's something they can fix: an unfinished block
      // (incomplete), an inferred month, OR a row only one main pass saw — the specialists'
      // raw text is a third/fourth reader that can corroborate a single-round row and clear
      // its "เห็นในรอบ OCR เดียว" flag.
      const needsSpecialists = merged.incomplete > 0
        || merged.rows.some(r => r.flags.some(f => f.includes("เดาเป็นเดือน") || f.includes("เห็นในรอบ OCR เดียว")));
      if (needsSpecialists) {
        // eng-only reads Latin tickers the Thai model mangles (keyed by share count);
        // tha-only reads Thai month abbreviations eng+tha renders as Latin (keyed by day+time).
        // Both specialist workers run concurrently (still peak 2 workers, since the main pair
        // was terminated first). Progress tracks the slower of the two over the same images.
        setProgress(`กำลังอ่านรูปที่ 1/${N}`); setPct(0);
        const done = [0, 0];
        const bump = (k: number) => {
          done[k]++;
          const slow = Math.min(done[0], done[1]);
          setProgress(`กำลังอ่านรูปที่ ${Math.min(slow + 1, N)}/${N}`);
          setPct(Math.round(((done[0] + done[1]) / (2 * N)) * 100));
        };
        const runLang = async (lang: string, k: number) => {
          const w = await mkWorker(lang);
          let text = "";
          for (let i = 0; i < N; i++) {
            const { data } = await w.recognize(await preprocess(list[i], 2));
            text += data.text + "\n"; bump(k);
          }
          await w.terminate();
          return text;
        };
        const [engText, thaText] = await Promise.all([runLang("eng", 0), runLang("tha", 1)]);
        const hints = extractTickerHints(engText);
        const monthHints = extractMonthHints(thaText);
        merged = parseMain(hints, monthHints, [engText, thaText]);
      }
      setResult(merged);
      setPct(null);
      setProgress(merged.rows.length ? "" : "อ่านไม่พบรายการในรูป — ใช้ภาพแคปหน้า Activity ที่เห็นบรรทัดเต็มๆ");
    } catch (e: any) {
      setPct(null);
      setProgress("OCR ล้มเหลว: " + (e?.message || String(e)));
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const flagged = result ? result.rows.filter(r => r.flags.length > 0) : [];

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
        onChange={e => e.target.files && run(e.target.files)} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ ...btnGhost({ fontSize: 12, opacity: busy ? 0.6 : 1 }) }}>
          {busy ? "กำลังอ่าน..." : "อัพโหลดรูป"}
        </button>
      </div>
      {progress && <div style={{ fontSize: 12, color: "var(--warn)", marginTop: 6 }}>{progress}</div>}
      {pct !== null && (
        <div style={{ marginTop: 6, height: 6, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--brass)", borderRadius: 999, transition: "width 0.2s ease" }} />
        </div>
      )}

      {result && result.rows.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 6 }}>
            อ่านได้ {result.rows.length} รายการ{flagged.length ? ` · ต้องตรวจ ${flagged.length} รายการ` : " · ผ่านการเช็คทุกแถว"}
            {result.incomplete > 0 ? ` · อ่านไม่ครบ ${result.incomplete} รายการ (ไม่ถูกนำมา)` : ""}
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: 8, fontFamily: "monospace", fontSize: 11.5 }}>
            {result.rows.map((r, i) => (
              <div key={i} style={{ color: r.flags.length ? "var(--warn)" : "var(--ink)", marginBottom: 2, wordBreak: "break-all" }}>
                {r.flags.length ? "⚠ " : "✓ "}{r.csv}
                {r.flags.map((f, j) => <div key={j} style={{ fontSize: 10.5, color: "var(--warn)", paddingLeft: 16 }}>{f}</div>)}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => { onAppend(result.rows.map(r => r.csv).join("\n"), result.rows.filter(r => r.flags.length).map(r => ({ csv: r.csv, cols: flagColumns(r.flags) }))); setResult(null); }}
              style={{ ...btnPrimary({ fontSize: 12, padding: "8px 14px" }) }}>
              วางลงช่อง Import ({result.rows.length} แถว)
            </button>
            {flagged.length > 0 && <span style={{ fontSize: 11, color: "var(--warn)" }}>แถว ⚠ ให้เทียบตัวเลขกับรูปก่อนกดนำเข้า</span>}
          </div>
        </div>
      )}
    </div>
  );
}
