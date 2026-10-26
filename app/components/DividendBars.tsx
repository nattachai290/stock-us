"use client";
import { useMemo, useState } from "react";
import { monthlyDividends, type DivRow } from "../lib/dividends";

// ปันผลรายเดือน — กราฟแท่งยอดสุทธิ (หลังภาษี) ต่อเดือนตามวันจ่าย: ส่วนทึบ = รับแล้ว,
// ส่วนโปร่งด้านบน = รอรับ (ผ่าน XD แล้วรอจ่าย / ประกาศแล้ว). ทีละปี (ม.ค.–ธ.ค.) เลือกปีจาก dropdown
// เริ่มที่ปีล่าสุด. แตะหรือชี้แท่งเพื่อดูรายละเอียด

const H = 140; // plot height, px

const fmt$ = (v: number) => "$" + v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymDate = (ym: string) => new Date(ym + "-15T12:00:00Z");
const monLabel = (ym: string) => ymDate(ym).toLocaleDateString("th-TH", { month: "short" });
const monYear = (ym: string) => ymDate(ym).toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
// round the axis top up to 1 / 2 / 2.5 / 5 × 10^k so gridline labels stay readable
const niceMax = (v: number) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find(f => f * p >= v) as number) * p;
};

export default function DividendBars({ rows }: { rows: DivRow[] }) {
  const thisYm = new Date().toISOString().slice(0, 7);
  // every year with a dividend (by payment month), newest first; the chart starts on the newest
  const years = useMemo(() => [...new Set(rows.map(r => (r.pay || r.ex).slice(0, 4)))].sort().reverse(), [rows]);
  const [pick, setPick] = useState<string | null>(null);
  const year = pick && years.includes(pick) ? pick : years[0];
  const [sel, setSel] = useState<string | null>(null);

  const months = useMemo(() => year ? monthlyDividends(rows, `${year}-01`, `${year}-12`) : [], [rows, year]);

  if (!months.length) return null;

  const top = niceMax(Math.max(...months.map(m => m.paid + m.coming)));
  const hasComing = months.some(m => m.coming > 0);
  // readout: the hovered/tapped month, else this month if it has money, else the latest
  // month already paid, else whatever is still to come
  const shown = months.find(m => m.ym === sel)
    ?? months.find(m => m.ym === thisYm && m.paid + m.coming > 0)
    ?? [...months].reverse().find(m => m.ym <= thisYm && m.paid > 0)
    ?? months.find(m => m.paid + m.coming > 0)
    ?? months[months.length - 1];
  const total = months.reduce((s, m) => s + m.paid, 0);
  const comingTotal = months.reduce((s, m) => s + m.coming, 0);
  // average over the months of the year that have happened (all 12 for a past year)
  const elapsed = months.filter(m => m.ym <= thisYm).length;

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>ปันผลรายเดือน</div>
        <select value={year} onChange={e => { setPick(e.target.value); setSel(null); }} aria-label="เลือกปี"
          style={{
            fontSize: 12, padding: "4px 8px", borderRadius: 8, cursor: "pointer",
            border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)",
          }}>
          {years.map(y => <option key={y} value={y}>ปี {+y + 543}</option>)}
        </select>
      </div>

      {/* readout for the selected month */}
      <div style={{ minHeight: 40, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{monYear(shown.ym)}</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{fmt$(shown.paid)}</span>
          {shown.coming > 0 && <span style={{ fontSize: 12, color: "var(--mut)" }}>+ รอรับ {fmt$(shown.coming)}</span>}
        </div>
        {/* every symbol that paid that month, wrapping onto more lines — a long month must not
            be cut off */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 4, fontSize: 11, color: "var(--mut)" }}>
          {shown.items.length ? shown.items.map(i => (
            <span key={i.symbol + i.paid} style={{ whiteSpace: "nowrap" }}>
              <span style={{ color: "var(--ink)", fontWeight: 600 }}>{i.symbol}</span> {fmt$(i.net)}{i.paid ? "" : " (รอ)"}
            </span>
          )) : <span style={{ color: "var(--faint)" }}>ไม่มีปันผลเดือนนี้</span>}
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
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: 3 }}>
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
                      background: active ? "color-mix(in srgb, var(--ink) 8%, transparent)" : "transparent",
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
                        borderRadius: ch > 0 ? 0 : "4px 4px 0 0",
                      }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
            {months.map(m => (
              <span key={m.ym} style={{
                flex: 1, minWidth: 0, textAlign: "center", fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden",
                color: m.ym === shown.ym ? "var(--ink)" : "var(--faint)",
              }}>
                {monLabel(m.ym)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <span style={{ fontSize: 11, color: "var(--faint)" }}>
          รับแล้วปี {+year + 543} {fmt$(total)}{comingTotal > 0 ? ` · รอรับ ${fmt$(comingTotal)}` : ""}{elapsed ? ` · เฉลี่ย ${fmt$(total / elapsed)}/เดือน` : ""}
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
