"use client";
import { IconGrid, IconBars, IconClock, IconSpark } from "./icons";

const NAV = [
  { key: "portfolio", label: "พอร์ต", Icon: IconGrid },
  { key: "chart", label: "กราฟ", Icon: IconBars },
  { key: "transactions", label: "ประวัติ", Icon: IconClock },
  { key: "ai", label: "AI", Icon: IconSpark },
] as const;

// Navigation shell (§3): a sticky left sidebar on desktop (≥900px, via the
// .app-sidebar CSS rule) and a fixed bottom tab bar on mobile (.app-bottom-tabs).
// Both render every time; the breakpoint in globals.css decides which is visible.
export default function AppShell({ tab, onTabChange }: { tab: string; onTabChange: (t: string) => void }) {
  return (
    <>
      <div className="app-sidebar">
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.14em", padding: "18px 16px 22px", fontFamily: '"Avenir Next",Futura,"Segoe UI",system-ui,sans-serif' }}>
          <span style={{ color: "var(--brass)" }}>SA</span><span style={{ color: "var(--ink)" }}>SOM</span>
        </div>
        {NAV.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => onTabChange(key)}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 16px",
              background: tab === key ? "var(--card2)" : "none", border: "none", cursor: "pointer",
              color: tab === key ? "var(--brass)" : "var(--mut)", fontSize: 13, fontWeight: 600, textAlign: "left",
            }}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      <div className="app-bottom-tabs">
        {NAV.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => onTabChange(key)}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "8px 0 6px",
              background: "none", border: "none", cursor: "pointer", color: tab === key ? "var(--brass)" : "var(--faint)",
            }}>
            <Icon size={15} />
            <span style={{ fontSize: 9.5, fontWeight: 600 }}>{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
