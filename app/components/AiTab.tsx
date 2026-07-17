"use client";
import { IconClipboard, IconZap, IconPencil, IconLightbulb, IconPaste, IconGrid } from "./icons";
import { btn, btnGhost } from "../lib/ui";

// AI hub tab (§5.8) — five prompt-generator cards. Every card just calls the
// same copy*() functions the old sidebar buttons called; no prompt text here.
export default function AiTab({
  hasHoldings, moversCount,
  onAnalyze, onMovers, onAllocation, onNewIdeas,
  showAllocImport, onTogglePasteTarget, allocText, setAllocText, onApplyAllocation, onCancelPasteTarget,
}: {
  hasHoldings: boolean;
  moversCount: number;
  onAnalyze: () => void;
  onMovers: () => void;
  onAllocation: () => void;
  onNewIdeas: () => void;
  showAllocImport: boolean;
  onTogglePasteTarget: () => void;
  allocText: string;
  setAllocText: (v: string) => void;
  onApplyAllocation: () => void;
  onCancelPasteTarget: () => void;
}) {
  const cards = [
    { Icon: IconClipboard, title: "วิเคราะห์พอร์ต", desc: "ภาพรวม + หาตัวที่ควรขายจริงๆ ตามพื้นฐาน", onClick: onAnalyze, disabled: !hasHoldings },
    { Icon: IconZap, title: "ตัวผิดปกติวันนี้", desc: "หุ้นขยับ ±3% — ค้นข่าวแล้ววิเคราะห์ว่าพื้นฐานเปลี่ยนไหม", onClick: onMovers, disabled: moversCount === 0, badge: moversCount },
    { Icon: IconPencil, title: "จัดทัพพอร์ต", desc: "แม่ทัพ / รองแม่ทัพ / ทหารเสริม → ได้ตาราง % พร้อมวางกลับ", onClick: onAllocation, disabled: !hasHoldings, highlight: true },
    { Icon: IconLightbulb, title: "แนะนำหุ้นใหม่", desc: "หาหุ้นพื้นฐานดีที่ยังไม่มีในพอร์ต 3–5 ตัว", onClick: onNewIdeas, disabled: !hasHoldings },
    { Icon: IconPaste, title: "วางผลจัดทัพ (Target %)", desc: "แปะตารางจาก Claude — ระบบตรวจรวม 100% ให้อัตโนมัติ", onClick: onTogglePasteTarget, disabled: !hasHoldings },
  ];

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>ผู้ช่วยวิเคราะห์</div>
      <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 16 }}>สร้างพรอมป์จากข้อมูลพอร์ตจริง → วางใน Claude แล้วนำผลกลับมาวาง</div>

      {!hasHoldings ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--faint)" }}>
          <IconGrid size={28} />
          <div style={{ marginTop: 8 }}>เพิ่มหุ้นก่อนถึงจะวิเคราะห์ได้</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cards.map((c, i) => (
            <button key={i} onClick={c.onClick} disabled={c.disabled}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                background: "var(--card)", border: c.highlight ? "1px solid var(--brass)" : "1px solid var(--line)",
                borderRadius: "var(--r-md)", padding: "14px 16px", cursor: c.disabled ? "default" : "pointer",
                opacity: c.disabled ? 0.5 : 1,
              }}>
              <span style={{ color: c.highlight ? "var(--brass)" : "var(--mut)", flexShrink: 0 }}><c.Icon size={20} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>{c.title}</span>
                  {c.badge != null && c.badge > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--on-brass)", background: "var(--warn)", borderRadius: 999, padding: "1px 7px" }}>{c.badge}</span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--mut)", marginTop: 2 }}>{c.desc}</div>
              </span>
              <span style={{ color: "var(--faint)", fontSize: 16, flexShrink: 0 }}>›</span>
            </button>
          ))}
        </div>
      )}

      {showAllocImport && (
        <div style={{ background: "var(--card)", borderRadius: 8, padding: 16, marginTop: 12, border: "1px solid var(--brass)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brass)", marginBottom: 6 }}>วางผลจัดทัพจาก Claude</div>
          <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 8 }}>รองรับ: <code style={{ color: "var(--brass)" }}>SYMBOL | ประเภท | %</code> หรือ table format จาก Claude</div>
          <textarea value={allocText} onChange={e => setAllocText(e.target.value)} placeholder={"AAPL | Satellite | 0.9%\nNVDA | Core | 6.0%\nOXY | ตัดออก | 0%"}
            style={{ width: "100%", minHeight: 160, background: "var(--bg)", color: "var(--ink)", border: "1px solid var(--brass)", borderRadius: 6, padding: 10, fontSize: 13, resize: "vertical", fontFamily: "monospace", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={onApplyAllocation} disabled={!allocText.trim()} style={btn("var(--brass)", "var(--on-brass)", { opacity: !allocText.trim() ? 0.5 : 1 })}>ใส่ Target % ทั้งหมด</button>
            <button onClick={onCancelPasteTarget} style={btn("var(--line)", "var(--mut)")}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 16, textAlign: "center" }}>ทุกพรอมป์นับเฉพาะหุ้นที่ถืออยู่จริง ไม่รวมตัวที่ขายหมด/ลบแล้ว</div>
    </div>
  );
}
