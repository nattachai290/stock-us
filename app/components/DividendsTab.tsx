"use client";
import { useState } from "react";
import { WITHHOLDING, type DivRow, type DivSummary } from "../lib/dividends";
import { IconCoin } from "./icons";
import DividendBars from "./DividendBars";

// แท็บปันผล — ข้อมูลทั้งหมดคำนวณใน page.tsx (lib/dividends): ปันผลต่อหุ้นดึงอัตโนมัติ
// แล้วเก็บประวัติลงไฟล์พอร์ตบน Drive (divHistory) ส่วนยอดที่ได้คิดจากประวัติซื้อขายทุกครั้ง

const fmt$ = (v: number) => "$" + v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
const SHOW = 12;
const card = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 16 } as const;

export default function DividendsTab({ rows, sum, errors, loading, hasSymbols, tv, thb, onRefresh }: {
  rows: DivRow[];
  sum: DivSummary | null;
  errors: Record<string, string>;
  loading: boolean;
  hasSymbols: boolean;           // any position with dated transactions to match against
  tv: number;                    // current market value, for the forward yield
  thb: (usd: number) => string | null;
  onRefresh: () => void;
}) {
  const [all, setAll] = useState(false);

  if (!hasSymbols) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--faint)" }}>
        <IconCoin size={28} />
        <div style={{ marginTop: 8 }}>ยังไม่มีประวัติซื้อขาย — ปันผลคำนวณจากจำนวนหุ้นที่ถือ ณ วัน XD</div>
      </div>
    );
  }

  const coming = rows.filter(r => r.status !== "paid").sort((a, b) => (a.pay || a.ex).localeCompare(b.pay || b.ex));
  const paid = rows.filter(r => r.status === "paid").sort((a, b) => (b.pay || b.ex).localeCompare(a.pay || a.ex));
  const shown = all ? paid : paid.slice(0, SHOW);
  const failed = Object.keys(errors);
  const yieldPct = sum && tv > 0 ? sum.forward / (1 - WITHHOLDING) / tv * 100 : 0;

  // received per symbol, biggest first
  const bySym = new Map<string, { net: number; n: number }>();
  for (const r of paid) { const x = bySym.get(r.symbol) || { net: 0, n: 0 }; x.net += r.net; x.n++; bySym.set(r.symbol, x); }
  const symRows = [...bySym.entries()].sort((a, b) => b[1].net - a[1].net);
  const symMax = symRows.length ? symRows[0][1].net : 0;

  const stat = (label: string, v: number, sub?: string | null) => (
    <div style={{ background: "var(--card2)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 10.5, color: "var(--faint)" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: v > 0 ? "var(--gain)" : "var(--ink)" }}>{fmt$(v)}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 1 }}>{sub}</div>}
    </div>
  );

  const row = (r: DivRow, i: number) => (
    <div key={`${r.symbol}-${r.ex}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "6px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
      <span style={{ width: 62, color: "var(--mut)", flexShrink: 0 }}>{thDate(r.pay || r.ex)}</span>
      <span style={{ width: 48, fontWeight: 700, color: "var(--brass)", flexShrink: 0 }}>{r.symbol}</span>
      <span style={{ flex: 1, minWidth: 0, color: "var(--faint)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {+r.shares.toFixed(4)} × ${r.perShare}
        {r.status === "upcoming" ? ` · XD ${thDate(r.ex)}` : r.status === "pending" ? " · รอจ่าย" : ""}
      </span>
      <span style={{ fontWeight: 700, color: r.status === "paid" ? "var(--gain)" : "var(--mut)", flexShrink: 0 }}>{fmt$(r.net)}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>ปันผล</div>
          <button onClick={onRefresh} disabled={loading}
            style={{ background: "var(--card2)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 10px", fontSize: 11, color: "var(--mut)", cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "กำลังโหลด…" : "ดึงใหม่"}
          </button>
        </div>
        {!sum ? (
          <div style={{ fontSize: 12, color: "var(--faint)", padding: "6px 0" }}>
            {loading ? "กำลังดึงข้อมูลปันผล…" : "ยังไม่มีปันผลในช่วงที่ถือหุ้น"}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            {stat("รับแล้วทั้งหมด", sum.received, thb(sum.received))}
            {stat(`ปี ${new Date().getFullYear() + 543}`, sum.thisYear, thb(sum.thisYear))}
            {stat("12 เดือนล่าสุด", sum.last12m, thb(sum.last12m))}
            {stat("คาดว่าจะได้ต่อปี", sum.forward, yieldPct > 0 ? `yield ${yieldPct.toFixed(2)}% ก่อนภาษี` : null)}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 10, lineHeight: 1.5 }}>
          ประมาณการ หลังหักภาษีสหรัฐ {WITHHOLDING * 100}% · จำนวนหุ้นที่ถือก่อนวัน XD × ปันผลต่อหุ้น · ประวัติปันผลเก็บใน Drive พร้อมพอร์ต — ยอดจริงดูใน statement ของโบรกเกอร์
        </div>
      </div>

      {rows.length > 0 && <DividendBars rows={rows} />}

      {coming.length > 0 && sum && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brass)", marginBottom: 4 }}>รอรับ {fmt$(sum.coming)}</div>
          {coming.map(row)}
        </div>
      )}

      {symRows.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 10 }}>รับแล้วแยกตามหุ้น</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {symRows.map(([sym, x]) => (
              <div key={sym} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 52, fontSize: 12, fontWeight: 700, color: "var(--brass)", flexShrink: 0 }}>{sym}</span>
                <span style={{ flex: 1, background: "var(--line)", borderRadius: 3, height: 8, overflow: "hidden" }}>
                  <span style={{ display: "block", width: `${symMax > 0 ? x.net / symMax * 100 : 0}%`, height: "100%", background: "var(--gain)", borderRadius: 3 }} />
                </span>
                <span style={{ fontSize: 11, color: "var(--faint)", width: 40, textAlign: "right", flexShrink: 0 }}>{x.n} ครั้ง</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", width: 72, textAlign: "right", flexShrink: 0 }}>{fmt$(x.net)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {paid.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>ประวัติที่ได้รับ</div>
          {shown.map(row)}
          {paid.length > SHOW && (
            <button onClick={() => setAll(v => !v)}
              style={{ width: "100%", marginTop: 6, padding: "6px 0", background: "none", border: "none", color: "var(--brass)", fontSize: 12, cursor: "pointer" }}>
              {all ? "ย่อ" : `ดูทั้งหมด (${paid.length})`}
            </button>
          )}
          {sum && sum.byYear.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {sum.byYear.map(y => (
                <span key={y.year} style={{ fontSize: 11, color: "var(--mut)", background: "var(--card2)", borderRadius: 999, padding: "2px 9px" }}>
                  {+y.year + 543}: {fmt$(y.net)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {failed.length > 0 && !loading && (
        <div style={{ fontSize: 11, color: "var(--faint)", textAlign: "center" }}>ดึงปันผลล่าสุดไม่ได้: {failed.join(", ")} — แสดงจากประวัติที่เก็บไว้</div>
      )}
    </div>
  );
}
