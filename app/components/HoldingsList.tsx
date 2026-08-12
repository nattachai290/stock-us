"use client";
import { trimSuggestion, addSuggestion } from "../lib/portfolio";

// Mobile card list for the portfolio tab (§5.3). Presentational only — all the
// numbers here are the same per-row math the old table already computed; this
// just renders them as cards instead of table cells, and taps open DetailSheet.
export default function HoldingsList({ holdings, tv, pc, onSelect }: {
  holdings: any[];
  tv: number;
  pc: (v: number) => string;
  onSelect: (id: number) => void;
}) {
  // The largest top-up in the visible list gets a "furthest from target" badge, so the
  // next buy is obvious without re-sorting. Only meaningful with more than one candidate.
  const adds = holdings.map((h: any) => addSuggestion(h, tv).amount);
  const maxAdd = Math.max(0, ...adds);
  const addCount = adds.filter(a => a > 0).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {holdings.map((h: any) => {
        const val = h.shares * h.currentPrice;
        const w = tv > 0 ? val / tv * 100 : 0;
        const target = h.targetPct || 0;
        const pp = h.avgCost > 0 ? (h.currentPrice - h.avgCost) / h.avgCost * 100 : 0;
        const isAlert = h.changePct != null && Math.abs(h.changePct) >= 3;
        const isStale = h.priceTime && (Date.now() - h.priceTime > 24 * 3600 * 1000);
        const barPct = target > 0 ? Math.min(w / target * 100, 100) : 0;
        // Over target → red, otherwise green. Same rule as DetailSheet and the desktop
        // table, so a position reads the same wherever it's shown. The bar caps at 100%,
        // so "full + red" = over target and "full + green" = exactly at target.
        const barColor = target > 0 && w > target ? "var(--loss)" : "var(--gain)";
        const trim = trimSuggestion(h, tv);
        const add = addSuggestion(h, tv);

        return (
          <div key={h.id} onClick={() => onSelect(h.id)}
            style={{ background: "var(--card)", border: "1px solid var(--line)", borderLeft: isAlert ? "3px solid var(--warn)" : "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "10px 12px", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--brass)" }}>{h.symbol}</span>
                {h.sector && <span style={{ fontSize: 10, color: "var(--mut)", background: "var(--card2)", borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>{h.sector}</span>}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>${h.currentPrice.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 11, color: "var(--mut)" }}>${val.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {w.toFixed(1)}%</span>
                {target > 0 && (
                  <span style={{ display: "inline-block", width: 52, height: 3.5, borderRadius: 2, background: "var(--line)", overflow: "hidden" }}>
                    <span style={{ display: "block", width: `${barPct}%`, height: "100%", background: barColor }} />
                  </span>
                )}
              </div>
              <div style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>
                {isAlert && <span style={{ color: pc(h.changePct), marginRight: 6 }}>วันนี้ {h.changePct > 0 ? "+" : ""}{h.changePct}%</span>}
                <span style={{ color: pc(pp) }}>P&L {pp >= 0 ? "+" : ""}{pp.toFixed(1)}%</span>
              </div>
            </div>

            {trim.amount > 0 && (
              <div style={{ fontSize: 10.5, color: "var(--loss)", marginTop: 4 }}>
                ขาย {trim.shares.toFixed(4)} หุ้น · เก็บกำไร +${trim.amount.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}

            {add.amount > 0 && (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, fontSize: 10.5, color: "var(--gain)", marginTop: 4 }}>
                <span>ซื้อ {add.shares.toFixed(4)} หุ้น (~${add.amount.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) ถึงเป้า</span>
                {add.belowCostPct < 0 && (
                  <span style={{ background: "var(--card2)", color: "var(--gain)", borderRadius: 999, padding: "1px 6px", fontWeight: 600 }}>
                    ต่ำกว่าทุน {add.belowCostPct.toFixed(1)}%
                  </span>
                )}
                {addCount > 1 && add.amount === maxAdd && (
                  <span style={{ background: "var(--card2)", color: "var(--brass)", borderRadius: 999, padding: "1px 6px", fontWeight: 600 }}>
                    ห่างเป้ามากสุด
                  </span>
                )}
              </div>
            )}

            {isStale && (
              <div style={{ fontSize: 10, color: "var(--warn)", marginTop: 4 }}>
                ⚠ ราคาเมื่อ {new Date(h.priceTime).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" })} — เก่ากว่า 24 ชม.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
