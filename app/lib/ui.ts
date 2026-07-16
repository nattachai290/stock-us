// ── shared inline-style helpers & palettes ────────────────────────────────────
import type React from "react";

export const btn = (bg: string, color: string, extra: any = {}) => ({ background: bg, color, border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", ...extra } as React.CSSProperties);

export const btnPrimary = (extra: any = {}) => ({ background: "var(--brass)", color: "var(--on-brass)", border: "none", borderRadius: "var(--r-sm)", padding: "10px 16px", fontSize: 14, fontWeight: 800, cursor: "pointer", ...extra } as React.CSSProperties);

export const btnGhost = (extra: any = {}) => ({ background: "var(--card2)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", ...extra } as React.CSSProperties);

export const btnDanger = (extra: any = {}) => ({ background: "transparent", color: "var(--loss)", border: "1px solid var(--loss)", borderRadius: "var(--r-sm)", padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", ...extra } as React.CSSProperties);

export const inp = { background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 4, color: "var(--ink)", fontSize: 13, padding: "4px 6px", width: 70 } as React.CSSProperties;

export const PIE_COLORS = ["#7ee8a2","#63b3ed","#f6c90e","#fc8181","#c084fc","#fb923c","#67e8f9","#86efac","#fca5a5","#93c5fd","#d8b4fe","#fcd34d","#6ee7b7","#a5b4fc","#f9a8d4"];
