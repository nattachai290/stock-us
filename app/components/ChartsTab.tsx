"use client";
import { IconBars } from "./icons";
import { sectorBreakdown } from "../lib/portfolio";

// Charts tab rewrite (§5.6) — 3 cards replacing the old recharts pie charts.
// All data comes from activeHoldings only; math is the same per-row math used
// elsewhere (value = shares*currentPrice, weight = value/tv), just aggregated.

export default function ChartsTab({ activeHoldings, tv, onFilterSector, onOpenDetail }: {
  activeHoldings: any[];
  tv: number;
  onFilterSector: (sector: string) => void;
  onOpenDetail: (id: number) => void;
}) {
  if (activeHoldings.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--faint)" }}>
        <IconBars size={28} />
        <div style={{ marginTop: 8 }}>ยังไม่มีข้อมูลให้แสดง — เพิ่มหุ้นก่อน</div>
      </div>
    );
  }
  // Holdings exist but no prices fetched yet — every weight would divide by zero
  if (tv === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--faint)" }}>
        <IconBars size={28} />
        <div style={{ marginTop: 8 }}>ยังไม่มีราคา — กด "อัพเดทราคา" ในแท็บพอร์ตก่อน</div>
      </div>
    );
  }

  // 1. Sector breakdown — every group (no "อื่นๆ" fold), with its unrealised P&L
  const sectors = sectorBreakdown(activeHoldings);
  const sectorMax = sectors.length ? sectors[0].value : 0;
  const money = (v: number) => "$" + Math.abs(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // 2. Top 10 by weight
  const top10 = [...activeHoldings].sort((a: any, b: any) => (b.shares * b.currentPrice) - (a.shares * a.currentPrice)).slice(0, 10);
  const top10Max = top10.length ? top10[0].shares * top10[0].currentPrice : 0;

  // 3. Top movers by P&L %
  const withPP = activeHoldings.filter((h: any) => h.avgCost > 0).map((h: any) => ({ h, pp: (h.currentPrice - h.avgCost) / h.avgCost * 100 }));
  const winners = [...withPP].filter(x => x.pp >= 0).sort((a, b) => b.pp - a.pp).slice(0, 3);
  const losers = [...withPP].filter(x => x.pp < 0).sort((a, b) => a.pp - b.pp).slice(0, 3);
  const maxAbsPP = Math.max(1, ...winners.map(x => x.pp), ...losers.map(x => Math.abs(x.pp)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Sector breakdown: one row per group — weight bar, value, share, and P&L on what's held */}
      <div style={{ background: "var(--card)", borderRadius: "var(--r-md)", padding: 16, border: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>สัดส่วนตาม Sector</div>
          <div style={{ fontSize: 10.5, color: "var(--faint)" }}>{sectors.length} กลุ่ม · กำไร/ขาดทุนที่ยังไม่ขาย</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sectors.map(s => {
            // "ไม่ระบุ" holdings have sector:"" — it doesn't match the portfolio-tab filter
            const filterable = s.name !== "ไม่ระบุ";
            const pc = s.pnl >= 0 ? "var(--gain)" : "var(--loss)";
            return (
              <div key={s.name} onClick={() => filterable && onFilterSector(s.name)} style={{ cursor: filterable ? "pointer" : "default" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5 }}>
                  <span style={{ flex: 1, minWidth: 0, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name} <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{s.count} ตัว</span>
                  </span>
                  <span style={{ color: "var(--mut)" }}>${s.value.toLocaleString("en", { maximumFractionDigits: 0 })}</span>
                  <span style={{ color: "var(--ink)", fontWeight: 600, width: 46, textAlign: "right" }}>{(s.value / tv * 100).toFixed(1)}%</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span style={{ flex: 1, background: "var(--line)", borderRadius: 3, height: 6, overflow: "hidden" }}>
                    <span style={{ display: "block", width: `${sectorMax > 0 ? s.value / sectorMax * 100 : 0}%`, height: "100%", background: "var(--brass)", borderRadius: 3 }} />
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: pc, whiteSpace: "nowrap", flexShrink: 0 }}>
                    {s.pnl >= 0 ? "+" : "−"}{money(s.pnl)} · {s.pnl >= 0 ? "+" : "−"}{Math.abs(s.pnlPct).toFixed(1)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top 10 by weight */}
      <div style={{ background: "var(--card)", borderRadius: "var(--r-md)", padding: 16, border: "1px solid var(--line)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 12 }}>Top 10 น้ำหนักพอร์ต</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {top10.map((h: any) => {
            const val = h.shares * h.currentPrice;
            return (
              <div key={h.id} onClick={() => onOpenDetail(h.id)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: "var(--brass)", flexShrink: 0 }}>{h.symbol}</span>
                <span style={{ flex: 1, background: "var(--line)", borderRadius: 3, height: 8, overflow: "hidden" }}>
                  <span style={{ display: "block", width: `${top10Max > 0 ? val / top10Max * 100 : 0}%`, height: "100%", background: "var(--brass)", borderRadius: 3 }} />
                </span>
                <span style={{ fontSize: 12, color: "var(--mut)", width: 44, textAlign: "right", flexShrink: 0 }}>{tv > 0 ? (val / tv * 100).toFixed(1) : "0"}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top movers by P&L % */}
      <div style={{ background: "var(--card)", borderRadius: "var(--r-md)", padding: 16, border: "1px solid var(--line)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 12 }}>กำไร/ขาดทุนสูงสุด (P&L %)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...winners, ...losers].map(({ h, pp }) => (
            <div key={h.id} onClick={() => onOpenDetail(h.id)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: "var(--brass)", flexShrink: 0 }}>{h.symbol}</span>
              <span style={{ flex: 1, background: "var(--line)", borderRadius: 3, height: 8, overflow: "hidden" }}>
                <span style={{ display: "block", width: `${Math.abs(pp) / maxAbsPP * 100}%`, height: "100%", background: pp >= 0 ? "var(--gain)" : "var(--loss)", borderRadius: 3 }} />
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: pp >= 0 ? "var(--gain)" : "var(--loss)", width: 56, textAlign: "right", flexShrink: 0 }}>{pp >= 0 ? "+" : ""}{pp.toFixed(1)}%</span>
            </div>
          ))}
          {winners.length === 0 && losers.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--faint)" }}>ยังไม่มีข้อมูลต้นทุนให้เทียบ</div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--faint)", textAlign: "center" }}>เฟสถัดไป: กราฟมูลค่าพอร์ตย้อนหลัง (ต้องเริ่มเก็บ snapshot รายวัน)</div>
    </div>
  );
}
