"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadPriceHistory, savePriceHistory, neededRanges, isCovered,
  portfolioValueSeries, type PriceHistory,
} from "../lib/pricehistory";

// มูลค่าพอตย้อนหลัง = ผลรวมของ (จำนวนหุ้นที่ถือ ณ วันนั้น × ราคาปิดวันนั้น) ทุก symbol
// ราคาปิดดึงครั้งเดียวเก็บบน Drive แชร์ทุกพอต — กดปุ่มเพื่อดึงเฉพาะตัวที่ยังไม่มี
const RANGES: { label: string; days: number | null }[] = [
  { label: "180 วัน", days: 180 },
  { label: "1 ปี", days: 365 },
  { label: "3 ปี", days: 365 * 3 },
  { label: "ทั้งหมด", days: null },
];

const fmt$ = (v: number) => "$" + v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (t: number) => { const d = new Date(t); return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; };

export default function PortfolioValueChart({
  holdings, token, onMsg,
}: { holdings: any[]; token: string | null; onMsg: (m: string) => void }) {
  const [cache, setCache] = useState<PriceHistory>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<number | null>(365);
  const [diag, setDiag] = useState<string[]>([]); // per-symbol fetch errors (for debugging on Vercel)

  // On login, pull whatever closes are already on Drive so the chart renders without a fetch.
  useEffect(() => {
    if (!token) { setLoaded(false); setCache({}); return; }
    let alive = true;
    loadPriceHistory(token)
      .then(({ data }) => { if (alive) { setCache(data); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [token]);

  const symbolsMissing = useMemo(() => {
    const ranges = neededRanges(holdings);
    return ranges.filter(r => !isCovered(cache, r.symbol, r.from));
  }, [holdings, cache]);

  const fetchMissing = useCallback(async () => {
    if (!token) { onMsg("กรุณา Login Google ก่อน (ราคาปิดเก็บบน Drive)"); return; }
    setBusy(true);
    try {
      const { fileId, data } = await loadPriceHistory(token);
      const ranges = neededRanges(holdings).filter(r => !isCovered(data, r.symbol, r.from));
      if (!ranges.length) { setCache(data); onMsg("ราคาปิดครบแล้ว ✓"); setBusy(false); return; }

      // One request per symbol-range (each symbol may start on a different date).
      const merged: PriceHistory = { ...data };
      const errs: string[] = [];
      let done = 0, failed = 0;
      for (const r of ranges) {
        onMsg(`ดึงราคาปิด... (${done + failed + 1}/${ranges.length}) ${r.symbol}`);
        try {
          const res = await fetch(`/api/history?symbols=${encodeURIComponent(r.symbol)}&from=${r.from}&to=${r.to}&t=${Date.now()}`, { cache: "no-store" });
          const j = await res.json();
          const dm = j.results?.[r.symbol];
          if (dm && Object.keys(dm).length) { merged[r.symbol] = { ...(merged[r.symbol] || {}), ...dm }; done++; }
          else { failed++; errs.push(`${r.symbol}: ${j.errors?.[r.symbol] || "no data"}`); }
        } catch (e: any) { failed++; errs.push(`${r.symbol}: ${e?.message || "fetch failed"}`); }
        await new Promise(res => setTimeout(res, 150));
      }
      if (done > 0) await savePriceHistory(token, fileId, merged);
      setCache(merged);
      setDiag(errs);
      onMsg(failed ? `ดึงแล้ว ${done} · พลาด ${failed} — ดูสาเหตุใต้กราฟ` : `ดึงราคาปิดครบ ${done} ตัว ✓`);
    } catch (e: any) {
      onMsg("ดึงราคาปิดไม่ได้: " + (e?.message || e));
    }
    setBusy(false);
  }, [token, holdings, onMsg]);

  const pts = useMemo(() => portfolioValueSeries(holdings, cache).filter(p => p.v > 0), [holdings, cache]);

  const now = Date.now();
  let view = pts;
  if (days) {
    const cutoff = now - days * 86400000;
    view = pts.filter(p => p.t >= cutoff);
  }
  const empty = view.length < 2;

  const W = 600, H = 160, P = 6;
  let path = "", area = "", minV = 0, maxV = 0, t0 = 0, t1 = 0;
  if (!empty) {
    t0 = view[0].t; t1 = view.at(-1)!.t;
    const vs = view.map(p => p.v);
    minV = Math.min(...vs); maxV = Math.max(...vs);
    const x = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
    const y = (v: number) => H - P - ((v - minV) / (maxV - minV || 1)) * (H - 2 * P);
    path = `M ${x(view[0].t)} ${y(view[0].v)}`;
    for (let i = 1; i < view.length; i++) path += ` L ${x(view[i].t)} ${y(view[i].v)}`;
    area = `${path} L ${x(view.at(-1)!.t)} ${H - P} L ${x(view[0].t)} ${H - P} Z`;
  }

  const missCount = symbolsMissing.length;
  const endV = view.at(-1)?.v ?? 0;
  const partialSet = useMemo(() => new Set(view.flatMap(p => p.missing)), [view]);

  return (
    <div style={{ background: "var(--card)", borderRadius: "var(--r-md)", padding: 16, marginBottom: 12, border: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: "var(--faint)" }}>มูลค่าพอตย้อนหลัง (ราคาปิด)</div>
        {!empty && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{fmt$(endV)}</div>}
      </div>

      {empty ? (
        <div style={{ fontSize: 12, color: "var(--mut)", padding: "22px 0", textAlign: "center" }}>
          {loaded && !Object.keys(cache).length ? "ยังไม่มีราคาปิด — กดปุ่มด้านล่างเพื่อดึง" : "ไม่มีข้อมูลพอในช่วงนี้"}
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="none" aria-label="กราฟมูลค่าพอตย้อนหลัง">
            <path d={area} fill="var(--brass)" opacity="0.08" />
            <path d={path} fill="none" stroke="var(--brass)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--mut)", marginTop: 2 }}>
            <span>{fmt$(minV)} – {fmt$(maxV)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>
            <span>{fmtD(t0)}</span><span>{fmtD(t1)}</span>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        {RANGES.map(r => (
          <button key={r.label} onClick={() => setDays(r.days)}
            style={{
              flex: 1, padding: "5px 0", fontSize: 11.5, borderRadius: 6, cursor: "pointer",
              border: "1px solid " + (days === r.days ? "var(--brass)" : "var(--line)"),
              background: days === r.days ? "var(--brass)" : "transparent",
              color: days === r.days ? "var(--on-brass)" : "var(--mut)", fontWeight: days === r.days ? 700 : 400,
            }}>
            {r.label}
          </button>
        ))}
      </div>

      <button onClick={fetchMissing} disabled={busy}
        style={{
          width: "100%", marginTop: 8, padding: "8px 0", fontSize: 12, borderRadius: 6, cursor: busy ? "default" : "pointer",
          border: "1px solid var(--line)", background: "transparent", color: "var(--mut)", opacity: busy ? 0.6 : 1,
        }}>
        {busy ? "กำลังดึง..." : missCount > 0 ? `⬇ ดึงราคาปิดย้อนหลัง (${missCount} ตัวใหม่)` : "↻ ดึงราคาปิดเพิ่ม/อัพเดท"}
      </button>

      {partialSet.size > 0 && (
        <div style={{ fontSize: 10.5, color: "var(--mut)", marginTop: 6 }}>
          ยังไม่มีราคาปิดบางวันของ: {[...partialSet].join(", ")}
        </div>
      )}

      {diag.length > 0 && (
        <div style={{ fontSize: 10, color: "#d08", marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          สาเหตุที่ดึงไม่ได้:{"\n"}{diag.slice(0, 12).join("\n")}{diag.length > 12 ? `\n…อีก ${diag.length - 12} ตัว` : ""}
        </div>
      )}
    </div>
  );
}
