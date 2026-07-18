"use client";
import { useRef, useState } from "react";
import { parseActivityText, mergeParses, type MergeResult } from "../lib/ocr";
import { btnGhost, btnPrimary } from "../lib/ui";

// Upload broker-app Activity screenshots → OCR (tesseract.js, fully client-side,
// assets self-hosted under /public/tesseract) → tx-import CSV rows appended into
// the existing Import textarea for review. Each image is OCR'd twice (2x and 3x
// upscale) and the passes are merged — see mergeParses in lib/ocr.ts. Nothing is
// imported automatically; the user reviews the textarea and presses นำเข้า as usual.
export default function OcrImport({ onAppend }: { onAppend: (csv: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<MergeResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Same pipeline verified against real screenshots: grayscale+invert at native
  // size (white-on-dark → black-on-white), then smooth upscale.
  const preprocess = async (file: File, scale: number): Promise<Blob> => {
    const bmp = await createImageBitmap(file);
    const c1 = document.createElement("canvas");
    c1.width = bmp.width; c1.height = bmp.height;
    const x1 = c1.getContext("2d")!;
    x1.drawImage(bmp, 0, 0);
    const id = x1.getImageData(0, 0, c1.width, c1.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 255 - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    x1.putImageData(id, 0, 0);
    const c2 = document.createElement("canvas");
    c2.width = Math.round(bmp.width * scale); c2.height = Math.round(bmp.height * scale);
    const x2 = c2.getContext("2d")!;
    x2.imageSmoothingEnabled = true; x2.imageSmoothingQuality = "high";
    x2.drawImage(c1, 0, 0, c2.width, c2.height);
    return new Promise((res, rej) => c2.toBlob(b => b ? res(b) : rej(new Error("canvas.toBlob failed")), "image/png"));
  };

  const run = async (files: FileList) => {
    if (!files.length) return;
    setBusy(true); setResult(null); setProgress("กำลังโหลดตัวอ่าน OCR (ครั้งแรกอาจใช้เวลาสักครู่)...");
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract",
        langPath: "/tesseract",
        gzip: true,
      });
      const list = Array.from(files);
      const texts: Record<number, string> = { 2: "", 3: "" };
      for (const scale of [2, 3]) {
        for (let i = 0; i < list.length; i++) {
          setProgress(`กำลังอ่านรูป ${i + 1}/${list.length} (รอบ ${scale - 1}/2)...`);
          const blob = await preprocess(list[i], scale);
          const { data } = await worker.recognize(blob);
          texts[scale] += data.text + "\n";
        }
      }
      await worker.terminate();
      const merged = mergeParses(parseActivityText(texts[2]), parseActivityText(texts[3]));
      setResult(merged);
      setProgress(merged.rows.length ? "" : "อ่านไม่พบรายการในรูป — ใช้ภาพแคปหน้า Activity ที่เห็นบรรทัดเต็มๆ");
    } catch (e: any) {
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
          {busy ? "กำลังอ่าน..." : "อ่านจากรูป (OCR ในเครื่อง — ฟรี)"}
        </button>
        <span style={{ fontSize: 11, color: "var(--faint)" }}>รองรับภาพแคปหน้า Activity ของโบรกเกอร์ · เลือกได้หลายรูป</span>
      </div>
      {progress && <div style={{ fontSize: 12, color: "var(--warn)", marginTop: 6 }}>{progress}</div>}

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
            <button onClick={() => { onAppend(result.rows.map(r => r.csv).join("\n")); setResult(null); }}
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
