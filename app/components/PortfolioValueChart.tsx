"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ensurePrices, portfolioValueSeries, benchmarkSeries, BENCHMARK_DEFS, type PriceHistory,
} from "../lib/pricehistory";

// มูลค่าพอตย้อนหลัง = ผลรวมของ (จำนวนหุ้นที่ถือ ณ วันนั้น × ราคาปิดวันนั้น) ทุก symbol
// ราคาปิด shard ต่อ symbol-year: cache ในเครื่อง (IndexedDB) + ดึงเฉพาะที่ขาด/ปีปัจจุบันผ่าน
// /api/history (Vercel Blob) — ปีเก่าโหลดครั้งเดียวตลอด
// days: number = last N days · null = all · "ytd" = since Jan 1 this year
type RangeVal = number | null | "ytd";
const RANGES: { label: string; days: RangeVal }[] = [
  { label: "7 วัน", days: 7 },
  { label: "30 วัน", days: 30 },
  { label: "90 วัน", days: 90 },
  { label: "180 วัน", days: 180 },
  { label: "YTD", days: "ytd" },
  { label: "1 ปี", days: 365 },
  { label: "3 ปี", days: 365 * 3 },
  { label: "5 ปี", days: 365 * 5 },
  { label: "10 ปี", days: 365 * 10 },
  { label: "ทั้งหมด", days: null },
];

const fmt$ = (v: number) => "$" + v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (t: number) => { const d = new Date(t); return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; };

export default function PortfolioValueChart({
  holdings, onMsg,
}: { holdings: any[]; token?: string | null; onMsg: (m: string) => void }) {
  const [cache, setCache] = useState<PriceHistory>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<RangeVal>(365);
  const [diag, setDiag] = useState<string[]>([]); // per-symbol fetch errors
  const [enabled, setEnabled] = useState<Set<string>>(new Set(["SPY", "QQQ"])); // shown benchmarks

  // onMsg is a fresh arrow each parent render; keep it in a ref so `load`'s identity stays
  // stable and the auto-load effect doesn't loop.
  const onMsgRef = useRef(onMsg);
  onMsgRef.current = onMsg;

  // Load prices for held symbols + enabled benchmarks: instant from IndexedDB, then only
  // missing/stale shards hit /api/history. `force` re-pulls the current year.
  const load = useCallback(async (force: boolean) => {
    if (!(holdings || []).length) { setCache({}); setLoaded(true); return; }
    setBusy(true);
    try {
      const { cache, errors } = await ensurePrices(holdings, [...enabled], force);
      setCache(cache);
      setDiag(Object.entries(errors).map(([s, e]) => `${s}: ${e}`));
      if (force) {
        const failed = Object.keys(errors).length;
        onMsgRef.current(failed ? `อัพเดทแล้ว · พลาด ${failed} ตัว — ดูใต้กราฟ` : "อัพเดทราคาปิดแล้ว ✓");
      }
    } catch (e: any) {
      onMsgRef.current("โหลดราคาปิดไม่ได้: " + (e?.message || e));
    }
    setBusy(false); setLoaded(true);
  }, [holdings, enabled]);

  // Auto-load whenever holdings or the enabled benchmarks change (enabling a new index
  // fetches it automatically).
  useEffect(() => { load(false); }, [load]);

  const fetchMissing = useCallback(() => load(true), [load]);

  const pts = useMemo(() => portfolioValueSeries(holdings, cache).filter(p => p.v > 0), [holdings, cache]);

  const now = Date.now();
  let view = pts;
  if (days === "ytd") {
    const jan1 = Date.parse(`${new Date().getFullYear()}-01-01T00:00:00Z`);
    view = pts.filter(p => p.t >= jan1);
  } else if (days) {
    const cutoff = now - days * 86400000;
    view = pts.filter(p => p.t >= cutoff);
  }
  const empty = view.length < 2;

  const lastOf = (arr: (number | null)[]) => [...arr].reverse().find(v => v != null) ?? null;

  // One computed series per enabled benchmark: the same buy/sell cash flows invested
  // into that index (SPY/QQQ/DIA/IWM) over the visible window.
  const benches = useMemo(() =>
    BENCHMARK_DEFS.filter(d => enabled.has(d.sym)).map(def => {
      const data = benchmarkSeries(view, holdings, cache, def.sym);
      return { def, data, end: lastOf(data), has: data.some(v => v != null) };
    }).filter(b => b.has),
  [view, holdings, cache, enabled]);

  const W = 600, H = 160, P = 6;
  let path = "", area = "", minV = 0, maxV = 0, t0 = 0, t1 = 0;
  const benchPaths: { d: string; color: string; dash: string }[] = [];
  if (!empty) {
    t0 = view[0].t; t1 = view.at(-1)!.t;
    const nn = (arr: (number | null)[]) => arr.filter((v): v is number => v != null);
    const all = [...view.map(p => p.v), ...benches.flatMap(b => nn(b.data))];
    minV = Math.min(...all); maxV = Math.max(...all);
    const x = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
    const y = (v: number) => H - P - ((v - minV) / (maxV - minV || 1)) * (H - 2 * P);
    path = `M ${x(view[0].t)} ${y(view[0].v)}`;
    for (let i = 1; i < view.length; i++) path += ` L ${x(view[i].t)} ${y(view[i].v)}`;
    area = `${path} L ${x(view.at(-1)!.t)} ${H - P} L ${x(view[0].t)} ${H - P} Z`;
    const line = (arr: (number | null)[]) => {
      let s = "", started = false;
      for (let i = 0; i < view.length; i++) {
        const bv = arr[i];
        if (bv == null) continue;
        s += `${started ? " L" : "M"} ${x(view[i].t)} ${y(bv)}`;
        started = true;
      }
      return s;
    };
    for (const b of benches) benchPaths.push({ d: line(b.data), color: b.def.color, dash: b.def.dash });
  }

  const endV = view.at(-1)?.v ?? 0;
  const partialSet = useMemo(() => new Set(view.flatMap(p => p.missing)), [view]);
  const pct = (v: number | null) => (v == null ? "" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
  const winColor = (v: number | null) => (v == null ? "var(--mut)" : v >= 0 ? "var(--pos, #16a34a)" : "var(--neg, #dc2626)");

  return (
    <div style={{ background: "var(--card)", borderRadius: "var(--r-md)", padding: 16, marginBottom: 12, border: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: "var(--faint)" }}>มูลค่าพอตย้อนหลัง (ราคาปิด)</div>
        {!empty && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{fmt$(endV)}</div>}
      </div>

      {empty ? (
        <div style={{ fontSize: 12, color: "var(--mut)", padding: "22px 0", textAlign: "center" }}>
          {busy ? "กำลังโหลดราคาปิด..." : loaded && !Object.keys(cache).length ? "ยังไม่มีราคาปิด — กดปุ่มด้านล่างเพื่อโหลด" : "ไม่มีข้อมูลพอในช่วงนี้"}
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="none" aria-label="กราฟมูลค่าพอตย้อนหลัง">
            <path d={area} fill="var(--brass)" opacity="0.08" />
            {benchPaths.map((b, i) => b.d && <path key={i} d={b.d} fill="none" stroke={b.color} strokeWidth="1.5" strokeDasharray={b.dash} vectorEffect="non-scaling-stroke" />)}
            <path d={path} fill="none" stroke="var(--brass)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", columnGap: 14, rowGap: 3, fontSize: 11, marginTop: 8 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--ink)", fontWeight: 700 }}>
              <span style={{ width: 14, height: 3, borderRadius: 2, background: "var(--brass)" }} /> พอต
            </span>
            <span style={{ textAlign: "right", fontWeight: 700, color: "var(--ink)" }}>{fmt$(endV)}</span>
            <span />
            {benches.map(b => {
              const o = b.end && b.end > 0 ? ((endV - b.end) / b.end) * 100 : null;
              return (
                <Fragment key={b.def.sym}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--mut)" }}>
                    <span style={{ width: 14, height: 0, borderTop: `2px dashed ${b.def.color}` }} /> {b.def.label}
                  </span>
                  <span style={{ textAlign: "right", color: "var(--mut)" }}>{b.end != null ? fmt$(b.end) : "—"}</span>
                  <span style={{ textAlign: "right", fontWeight: 700, color: winColor(o) }}>{o == null ? "" : `${o >= 0 ? "ชนะ " : "แพ้ "}${pct(o)}`}</span>
                </Fragment>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>
            <span>{fmtD(t0)}</span><span>{fmtD(t1)}</span>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {RANGES.map(r => (
          <button key={r.label} onClick={() => setDays(r.days)}
            style={{
              flex: "1 1 auto", minWidth: 52, padding: "5px 8px", fontSize: 11.5, borderRadius: 999, cursor: "pointer",
              border: "1px solid " + (days === r.days ? "var(--brass)" : "var(--line)"),
              background: days === r.days ? "var(--brass)" : "transparent",
              color: days === r.days ? "var(--on-brass)" : "var(--mut)", fontWeight: days === r.days ? 700 : 400,
            }}>
            {r.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 10.5, color: "var(--faint)" }}>เทียบ:</span>
        {BENCHMARK_DEFS.map(d => {
          const on = enabled.has(d.sym);
          return (
            <button key={d.sym} onClick={() => setEnabled(prev => { const n = new Set(prev); n.has(d.sym) ? n.delete(d.sym) : n.add(d.sym); return n; })}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", fontSize: 11, borderRadius: 999, cursor: "pointer",
                border: "1px solid " + (on ? d.color : "var(--line)"),
                background: on ? d.color + "22" : "transparent",
                color: on ? "var(--ink)" : "var(--mut)", fontWeight: on ? 600 : 400, opacity: on ? 1 : 0.7,
              }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: d.color, opacity: on ? 1 : 0.4 }} />
              {d.label}
            </button>
          );
        })}
      </div>

      <button onClick={fetchMissing} disabled={busy}
        style={{
          width: "100%", marginTop: 8, padding: "8px 0", fontSize: 12, borderRadius: 6, cursor: busy ? "default" : "pointer",
          border: "1px solid var(--line)", background: "transparent", color: "var(--mut)", opacity: busy ? 0.6 : 1,
        }}>
        {busy ? "กำลังอัพเดท..." : "↻ อัพเดทราคาปิดล่าสุด"}
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
