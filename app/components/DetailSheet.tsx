"use client";
import Sheet from "./Sheet";
import { btnPrimary, btnGhost } from "../lib/ui";

// Detail view for a single holding, opened by tapping a card in the mobile list
// (§5.4). Pure presentation + the same handlers the old table/action-menu used —
// no new business logic, "underNeed"/"overAmt" mirror the existing table row math.
export default function DetailSheet({
  holding, onClose, tv, pc, editId, onEditIdChange, updateH, confirmEdit,
  onBuy, onSell, onSplit, onHistory, onRemove,
}: {
  holding: any | null;
  onClose: () => void;
  tv: number;
  pc: (v: number) => string;
  editId: number | null;
  onEditIdChange: (id: number | null) => void;
  updateH: (id: number, field: string, value: string) => void;
  confirmEdit: () => void;
  onBuy: (id: number) => void;
  onSell: (id: number) => void;
  onSplit: (id: number) => void;
  onHistory: (symbol: string) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <Sheet open={!!holding} onClose={onClose} maxWidth={420}>
      {holding && (() => {
        const h = holding;
        const val = h.shares * h.currentPrice;
        const w = tv > 0 ? val / tv * 100 : 0;
        const target = h.targetPct || 0;
        const unrealized = h.shares > 0 ? (h.currentPrice - h.avgCost) * h.shares : 0;
        const realized = (h.realizedHistory || []).reduce((s: number, r: any) => s + (r.gain || 0), 0);
        const underNeed = (target > 0 && target < 100 && w < target) ? ((target / 100 * tv - val) / (1 - target / 100)) : 0;
        const overAmt = (target > 0 && w > target) ? ((w - target) / 100 * tv) : 0;
        const isEditing = editId === h.id;

        if (isEditing) {
          return (<>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--brass)", marginBottom: 14 }}>แก้ไข {h.symbol}</div>
            {[{ k: "sector", l: "กลุ่มธุรกิจ" }, { k: "note", l: "หมายเหตุ" }].map(f => (
              <div key={f.k} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--mut)", marginBottom: 3 }}>{f.l}</div>
                <input value={(h as any)[f.k] || ""} onChange={e => updateH(h.id, f.k, e.target.value)}
                  style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "9px 12px", color: "var(--ink)", fontSize: 13, boxSizing: "border-box" }} />
              </div>
            ))}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "var(--mut)", marginBottom: 3 }}>ราคาปัจจุบัน (manual override)</div>
              <input type="number" value={h.currentPrice} onChange={e => updateH(h.id, "currentPrice", e.target.value)}
                style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "9px 12px", color: "var(--ink)", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "var(--mut)", marginBottom: 3 }}>เป้าหมาย %</div>
              <input type="number" value={h.targetPct != null ? h.targetPct : ""} onChange={e => updateH(h.id, "targetPct", e.target.value)}
                style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "9px 12px", color: "var(--ink)", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={confirmEdit} style={{ ...btnPrimary(), flex: 1 }}>บันทึก</button>
              <button onClick={() => onEditIdChange(null)} style={{ ...btnGhost(), flex: 1 }}>ยกเลิก</button>
            </div>
          </>);
        }

        return (<>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--brass)" }}>{h.symbol}</div>
              {h.sector && <div style={{ fontSize: 11, color: "var(--mut)" }}>{h.sector}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>${h.currentPrice.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              {h.changePct != null && <div style={{ fontSize: 12, fontWeight: 600, color: pc(h.changePct) }}>{h.changePct > 0 ? "+" : ""}{h.changePct}% วันนี้</div>}
            </div>
          </div>

          <div style={{ marginTop: 14, borderTop: "1px solid var(--line)" }}>
            {[
              { l: "จำนวนหุ้น", v: `${h.shares.toFixed(4)} (${h.shares.toFixed(7)})` },
              { l: "ต้นทุน/หุ้น", v: `$${h.avgCost.toFixed(4)}`, hint: "FIFO ตรงโบรก" },
              { l: "มูลค่า", v: `$${val.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
              { l: "Unrealized", v: `${unrealized >= 0 ? "+" : ""}$${unrealized.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: pc(unrealized) },
              { l: "Realized สะสม", v: `${realized >= 0 ? "+" : ""}$${realized.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: pc(realized) },
            ].map(row => (
              <div key={row.l} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px dashed var(--line)", fontSize: 13 }}>
                <span style={{ color: "var(--faint)" }}>{row.l}{row.hint && <span style={{ fontSize: 10, marginLeft: 6, color: "var(--faint)" }}>({row.hint})</span>}</span>
                <span style={{ color: row.color || "var(--ink)", fontWeight: 600 }}>{row.v}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 4 }}>น้ำหนัก {w.toFixed(1)}%{target > 0 ? ` / เป้า ${target}%` : ""}</div>
            {target > 0 && <div style={{ background: "var(--line)", borderRadius: 3, height: 4, overflow: "hidden" }}><div style={{ width: `${Math.min(w / target * 100, 100)}%`, height: "100%", background: w > target ? "var(--loss)" : "var(--brass)", borderRadius: 3 }} /></div>}
            {underNeed > 0 && <div style={{ fontSize: 12, color: "var(--gain)", marginTop: 4 }}>ซื้อเพิ่ม ~${underNeed.toLocaleString("en", { maximumFractionDigits: 2 })} ถึงเป้า</div>}
            {overAmt > 0 && <div style={{ fontSize: 12, color: "var(--loss)", marginTop: 4 }}>เกิน +${overAmt.toFixed(2)}</div>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 16 }}>
            <button onClick={() => onBuy(h.id)} style={{ ...btnPrimary({ padding: "10px 4px", fontSize: 12 }) }}>ซื้อ</button>
            <button onClick={() => onSell(h.id)} style={{ ...btnGhost({ padding: "10px 4px", fontSize: 12 }) }}>ขาย</button>
            <button onClick={() => onSplit(h.id)} style={{ ...btnGhost({ padding: "10px 4px", fontSize: 12 }) }}>แตกพาร์</button>
            <button onClick={() => onHistory(h.symbol)} style={{ ...btnGhost({ padding: "10px 4px", fontSize: 12 }) }}>ประวัติ</button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={() => onEditIdChange(h.id)} style={{ ...btnGhost({ flex: 1, fontSize: 12 }) }}>แก้ไขข้อมูล</button>
            <button onClick={() => onRemove(h.id)} style={{ flex: 1, background: "transparent", border: "1px solid var(--loss)", color: "var(--loss)", borderRadius: "var(--r-sm)", padding: "10px 4px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>ลบออกจาก Port</button>
          </div>
        </>);
      })()}
    </Sheet>
  );
}
