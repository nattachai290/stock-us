"use client";
import { useEffect, useState } from "react";
import { IconDots } from "./icons";

export type ToolsMenuItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };

// Reusable "⋯" dropdown used by the portfolio tab and history tab tool menus
// (§3.3) — pure presentation, callers pass the same handlers the old sidebar
// buttons called directly.
export default function ToolsMenu({ items, label = "เครื่องมือ" }: { items: ToolsMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const normal = items.filter(i => !i.danger);
  const danger = items.filter(i => i.danger);

  const renderItem = (it: ToolsMenuItem, i: number) => (
    <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}
      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: it.disabled ? "default" : "pointer", color: it.danger ? "var(--loss)" : "var(--ink)", fontSize: 13, padding: "10px 12px", borderRadius: 6, opacity: it.disabled ? 0.5 : 1 }}>
      {it.label}
    </button>
  );

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(v => !v)} aria-label={label} title={label}
        style={{ background: "var(--card2)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", color: "var(--mut)", cursor: "pointer", padding: "8px 12px", display: "flex", alignItems: "center" }}>
        <IconDots />
      </button>
      {open && (<>
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", boxShadow: "var(--shadow)", padding: 6, minWidth: 210, zIndex: 61 }}>
          {normal.map(renderItem)}
          {danger.length > 0 && (
            <div style={{ borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 4 }}>
              {danger.map(renderItem)}
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}
