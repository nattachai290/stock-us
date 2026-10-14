"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ensureDividends, dividendRows, dividendSummary, WITHHOLDING, type DivMap, type DivSummary } from "../lib/dividends";

// ปันผล — ดึงประวัติปันผลต่อหุ้นอัตโนมัติ แล้วคำนวณจากประวัติซื้อขายว่าถือกี่หุ้น ณ วัน XD
// ไม่มีการกรอกเอง ไม่บันทึกลง Drive (คำนวณใหม่ทุกครั้ง)

const fmt$ = (v: number) => "$" + v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
const SHOW = 8;

export default function DividendsCard({ holdings, tv, onSummary }: {
  holdings: any[];             // raw holdings incl. hidden — sold positions earned dividends too
  tv: number;                  // current market value, for the forward yield
  onSummary?: (s: DivSummary | null) => void;
}) {
  const [divs, setDivs] = useState<DivMap>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(false);
  const onSummaryRef = useRef(onSummary);
  onSummaryRef.current = onSummary;

  // Only symbols that have dated transactions can be matched to an ex-date.
  const symbols = useMemo(() => [...new Set((holdings || [])
    .filter((h: any) => h.symbol && ((h.buyHistory || []).length || (h.realizedHistory || []).length))
    .map((h: any) => h.symbol as string))].sort(), [holdings]);
  const symKey = symbols.join(",");

  useEffect(() => {
    if (!symKey) { setDivs({}); setErrors({}); return; }
    let live = true;
    setLoading(true);
    ensureDividends(symKey.split(",")).then(({ divs, errors }) => {
      if (!live) return;
      setDivs(divs); setErrors(errors); setLoading(false);
    });
    return () => { live = false; };
  }, [symKey]);

  const rows = useMemo(() => dividendRows(holdings, divs), [holdings, divs]);
  const sum = useMemo(() => dividendSummary(rows, holdings, divs), [rows, holdings, divs]);

  useEffect(() => { onSummaryRef.current?.(rows.length ? sum : null); }, [rows.length, sum]);

  if (!symbols.length) return null;

  const coming = rows.filter(r => r.status !== "paid").sort((a, b) => (a.pay || a.ex).localeCompare(b.pay || b.ex));
  const paid = rows.filter(r => r.status === "paid").sort((a, b) => (b.pay || b.ex).localeCompare(a.pay || a.ex));
  const shown = all ? paid : paid.slice(0, SHOW);
  const failed = Object.keys(errors);
  const yieldPct = tv > 0 ? sum.forward / (1 - WITHHOLDING) / tv * 100 : 0;

  const stat = (label: string, v: number, sub?: string) => (
    <div style={{ background: "var(--card2)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 10.5, color: "var(--faint)" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: v > 0 ? "var(--gain)" : "var(--ink)" }}>{fmt$(v)}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 1 }}>{sub}</div>}
    </div>
  );

  const row = (r: typeof rows[number], i: number) => (
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
    <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>ปันผล</div>
        <div style={{ fontSize: 10.5, color: "var(--faint)" }}>{loading ? "กำลังโหลด…" : `ประมาณการ · หลังหักภาษี ${WITHHOLDING * 100}%`}</div>
      </div>

      {!rows.length ? (
        <div style={{ fontSize: 12, color: "var(--faint)", padding: "6px 0" }}>
          {loading ? "กำลังดึงข้อมูลปันผล…" : "ยังไม่มีปันผลในช่วงที่ถือหุ้น"}
        </div>
      ) : (<>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          {stat("รับแล้วทั้งหมด", sum.received)}
          {stat(`ปี ${new Date().getFullYear() + 543}`, sum.thisYear)}
          {stat("12 เดือนล่าสุด", sum.last12m)}
          {stat("คาดว่าจะได้ต่อปี", sum.forward, yieldPct > 0 ? `yield ${yieldPct.toFixed(2)}% ก่อนภาษี` : undefined)}
        </div>

        {coming.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--brass)", marginBottom: 2 }}>รอรับ {fmt$(sum.coming)}</div>
            {coming.map(row)}
          </div>
        )}

        {paid.length > 0 && (
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--mut)", marginBottom: 2 }}>ได้รับแล้ว</div>
            {shown.map(row)}
            {paid.length > SHOW && (
              <button onClick={() => setAll(v => !v)}
                style={{ width: "100%", marginTop: 6, padding: "6px 0", background: "none", border: "none", color: "var(--brass)", fontSize: 12, cursor: "pointer" }}>
                {all ? "ย่อ" : `ดูทั้งหมด (${paid.length})`}
              </button>
            )}
          </div>
        )}

        {sum.byYear.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {sum.byYear.map(y => (
              <span key={y.year} style={{ fontSize: 11, color: "var(--mut)", background: "var(--card2)", borderRadius: 999, padding: "2px 9px" }}>
                {+y.year + 543}: {fmt$(y.net)}
              </span>
            ))}
          </div>
        )}
      </>)}

      {failed.length > 0 && !loading && (
        <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 8 }}>ดึงปันผลไม่ได้: {failed.join(", ")}</div>
      )}
      <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 8, lineHeight: 1.5 }}>
        คำนวณจากจำนวนหุ้นที่ถือก่อนวัน XD × ปันผลต่อหุ้น — ยอดจริงดูใน statement ของโบรกเกอร์
      </div>
    </div>
  );
}
