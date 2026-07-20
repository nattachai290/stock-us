"use client";
import { useMemo, useState } from "react";
import { investedSeries } from "../lib/invested";

// เส้นเงินลงทุนสะสมตามเวลา (step line) — คำนวณจาก buyHistory ล้วนๆ ไม่มีราคาตลาด
// เข้ามาเกี่ยว จึงย้อนหลังได้เต็มตั้งแต่ไม้แรก. ช่วงเวลาเลือกได้; ค่าท้ายเส้นตรงกับ
// สถิติ "ลงทุนสะสมทั้งหมด" ในการ์ดหลักเสมอ.
const RANGES: { label: string; days: number | null }[] = [
  { label: "30 วัน", days: 30 },
  { label: "180 วัน", days: 180 },
  { label: "1 ปี", days: 365 },
  { label: "ทั้งหมด", days: null },
];

const fmt$ = (v: number) => "$" + v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (t: number) => { const d = new Date(t); return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`; };

export default function InvestedChart({ holdings }: { holdings: any[] }) {
  const pts = useMemo(() => investedSeries(holdings), [holdings]);
  const [days, setDays] = useState<number | null>(null);
  if (pts.length < 2) return null; // ยังไม่มีประวัติพอจะเป็นเส้น

  const now = Date.now();
  let view = pts;
  if (days) {
    const cutoff = now - days * 86400000;
    const carry = pts.filter(p => p.t < cutoff).at(-1)?.v ?? 0;
    view = [...(carry > 0 ? [{ t: cutoff, v: carry }] : []), ...pts.filter(p => p.t >= cutoff)];
  }
  const last = view.at(-1);
  if (last && last.t < now) view = [...view, { t: now, v: last.v }]; // ลากเส้นถึงวันนี้
  const empty = view.length < 2;

  const W = 600, H = 150, P = 6;
  let path = "", startV = 0, endV = 0, t0 = 0, t1 = 0;
  if (!empty) {
    t0 = view[0].t; t1 = view.at(-1)!.t;
    startV = view[0].v; endV = view.at(-1)!.v;
    const x = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
    const y = (v: number) => H - P - ((v - startV) / (endV - startV || 1)) * (H - 2 * P);
    path = `M ${x(view[0].t)} ${y(view[0].v)}`;
    for (let i = 1; i < view.length; i++) path += ` L ${x(view[i].t)} ${y(view[i - 1].v)} L ${x(view[i].t)} ${y(view[i].v)}`;
  }

  return (
    <div style={{ background: "var(--card)", borderRadius: "var(--r-md)", padding: 16, marginBottom: 12, border: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: "var(--faint)" }}>เงินลงทุนสะสม</div>
        {!empty && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{fmt$(endV)}</div>}
      </div>
      {empty ? (
        <div style={{ fontSize: 12, color: "var(--mut)", padding: "18px 0", textAlign: "center" }}>ไม่มีรายการซื้อในช่วงนี้</div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="none" aria-label="กราฟเงินลงทุนสะสม">
            <path d={`${path} L ${W - P} ${H - P} L ${P} ${H - P} Z`} fill="var(--brass)" opacity="0.08" />
            <path d={path} fill="none" stroke="var(--brass)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--mut)" }}>
            <span>{fmt$(startV)}</span>
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
    </div>
  );
}
