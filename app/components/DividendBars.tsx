"use client";
import { useMemo, useState } from "react";
import { monthlyDividends, type DivRow } from "../lib/dividends";

// ปันผลรายเดือน — กราฟแท่งยอดสุทธิ (หลังภาษี) ต่อเดือนตามวันจ่าย: ส่วนทึบ = รับแล้ว,
// ส่วนโปร่งด้านบน = รอรับ (ผ่าน XD แล้วรอจ่าย / ประกาศแล้ว). แตะหรือชี้แท่งเพื่อดูรายละเอียด

type Range = 12 | 24 | 0; // months back, 0 = since the first dividend
const RANGES: { label: string; v: Range }[] = [
  { label: "12 เดือน", v: 12 }, { label: "24 เดือน", v: 24 }, { label: "ทั้งหมด", v: 0 },
];
const H = 140; // plot height, px

const fmt$ = (v: number) => "$" + v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymDate = (ym: string) => new Date(ym + "-15T12:00:00Z");
const monLabel = (ym: string) => ymDate(ym).toLocaleDateString("th-TH", { month: "short" });
const monYear = (ym: string) => ymDate(ym).toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
const shiftYm = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
// round the axis top up to 1 / 2 / 2.5 / 5 × 10^k so gridline labels stay readable
const niceMax = (v: number) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find(f => f * p >= v) as number) * p;
};

export default function DividendBars({ rows }: { rows: DivRow[] }) {
  const [range, setRange] = useState<Range>(12);
  const [sel, setSel] = useState<string | null>(null);

  const thisYm = new Date().toISOString().slice(0, 7);
  const months = useMemo(() => {
    if (!rows.length) return [];
    const yms = rows.map(r => (r.pay || r.ex).slice(0, 7));
    const first = yms.reduce((a, b) => (a < b ? a : b));
    const last = yms.reduce((a, b) => (a > b ? a : b));
    const to = last > thisYm ? last : thisYm;           // keep months with money still to come
    const from = range === 0 ? first : shiftYm(thisYm, -(range - 1));
    return monthlyDividends(rows, from < to ? from : to, to);
  }, [rows, range, thisYm]);

  if (!months.length) return null;

  const top = niceMax(Math.max(...months.map(m => m.paid + m.coming)));
  const hasComing = months.some(m => m.coming > 0);
  // label every Nth month: at most ~7 labels, which still fit at phone width with a year on one
  const every = months.length <= 8 ? 1 : months.length <= 16 ? 2 : Math.ceil(months.length / 6);
  const firstLabel = (months.length - 1) % every;       // first labelled month carries the year
  // readout: the hovered/tapped month, else this month if it has money, else the latest
  // month already paid, else whatever is still to come
  const shown = months.find(m => m.ym === sel)
    ?? months.find(m => m.ym === thisYm && m.paid + m.coming > 0)
    ?? [...months].reverse().find(m => m.ym <= thisYm && m.paid > 0)
    ?? months.find(m => m.paid + m.coming > 0)
    ?? months[months.length - 1];
  const total = months.reduce((s, m) => s + m.paid, 0);
  const withMoney = months.filter(m => m.paid > 0).length;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>ปันผลรายเดือน</div>
        <div style={{ display: "flex", gap: 4 }}>
          {RANGES.map(r => (
            <button key={r.v} onClick={() => { setRange(r.v); setSel(null); }}
              style={{
                fontSize: 11, padding: "3px 9px", borderRadius: 999, cursor: "pointer",
                border: "1px solid " + (range === r.v ? "var(--brass)" : "var(--line)"),
                background: range === r.v ? "var(--card2)" : "none",
                color: range === r.v ? "var(--brass)" : "var(--mut)",
              }}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* readout for the selected month */}
      <div style={{ minHeight: 40, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{monYear(shown.ym)}</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{fmt$(shown.paid)}</span>
          {shown.coming > 0 && <span style={{ fontSize: 12, color: "var(--mut)" }}>+ รอรับ {fmt$(shown.coming)}</span>}
        </div>
        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {shown.items.length
            ? shown.items.map(i => `${i.symbol} ${fmt$(i.net)}${i.paid ? "" : " (รอ)"}`).join(" · ")
            : "ไม่มีปันผลเดือนนี้"}
        </div>
      </div>

      {/* plot: recessive gridlines at 0 / ½ / top, bars anchored to the baseline */}
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ position: "relative", width: 34, height: H, flexShrink: 0 }}>
          {[top, top / 2, 0].map((v, i) => (
            <span key={i} style={{ position: "absolute", right: 0, top: (i * H) / 2 - 6, fontSize: 9.5, color: "var(--faint)" }}>
              ${v >= 100 ? Math.round(v) : +v.toFixed(v < 10 ? 2 : 1)}
            </span>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ position: "relative", height: H }} onPointerLeave={e => { if (e.pointerType === "mouse") setSel(null); }}>
            {[0, 0.5, 1].map(f => (
              <div key={f} style={{ position: "absolute", left: 0, right: 0, top: f * H, borderTop: `1px ${f === 1 ? "solid" : "dashed"} var(--line)` }} />
            ))}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: months.length > 30 ? 1 : 3 }}>
              {months.map(m => {
                const ph = (m.paid / top) * H, ch = (m.coming / top) * H;
                const active = m.ym === shown.ym;
                return (
                  // the whole column is the hit target, not just the bar
                  <div key={m.ym} role="img"
                    aria-label={`${monYear(m.ym)} รับแล้ว ${fmt$(m.paid)}${m.coming > 0 ? ` รอรับ ${fmt$(m.coming)}` : ""}`}
                    onPointerEnter={() => setSel(m.ym)} onPointerDown={() => setSel(m.ym)}
                    style={{
                      flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end",
                      alignItems: "center", cursor: "pointer", borderRadius: 4,
                      background: active ? "color-mix(in srgb, var(--ink) 6%, transparent)" : "transparent",
                    }}>
                    {ch > 0 && (
                      <div style={{
                        width: "72%", maxWidth: 28, height: Math.max(ch, 2), boxSizing: "border-box",
                        border: "1.5px dashed var(--gain)", borderRadius: "4px 4px 0 0",
                        borderBottom: ph > 0 ? "none" : undefined, marginBottom: ph > 0 ? 2 : 0,
                        background: "color-mix(in srgb, var(--gain) 18%, transparent)",
                      }} />
                    )}
                    {ph > 0 && (
                      <div style={{
                        width: "72%", maxWidth: 28, height: Math.max(ph, 2), background: "var(--gain)",
                        borderRadius: ch > 0 ? 0 : "4px 4px 0 0", opacity: active || !sel ? 1 : 0.55,
                      }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: months.length > 30 ? 1 : 3, marginTop: 4 }}>
            {months.map((m, i) => (
              <span key={m.ym} style={{
                flex: 1, minWidth: 0, textAlign: "center", fontSize: 9.5, whiteSpace: "nowrap", overflow: "visible",
                color: m.ym === shown.ym ? "var(--ink)" : "var(--faint)",
              }}>
                {(months.length - 1 - i) % every !== 0 ? ""
                  : m.ym.endsWith("-01") || i === firstLabel ? monYear(m.ym) : monLabel(m.ym)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <span style={{ fontSize: 11, color: "var(--faint)" }}>
          รวม {fmt$(total)} · เฉลี่ย {fmt$(withMoney ? total / months.filter(m => m.ym <= thisYm).length : 0)}/เดือน
        </span>
        {hasComing && (
          <span style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--mut)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: "var(--gain)" }} />รับแล้ว
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, boxSizing: "border-box", border: "1.5px dashed var(--gain)", background: "color-mix(in srgb, var(--gain) 18%, transparent)" }} />รอรับ
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
