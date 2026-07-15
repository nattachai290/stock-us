// ── shared inline-style helpers & palettes ────────────────────────────────────
import type React from "react";

export const btn = (bg: string, color: string, extra: any = {}) => ({ background: bg, color, border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", ...extra } as React.CSSProperties);

export const inp = { background: "#0f1117", border: "1px solid #4a5568", borderRadius: 4, color: "#e2e8f0", fontSize: 13, padding: "4px 6px", width: 70 } as React.CSSProperties;

export const PIE_COLORS = ["#7ee8a2","#63b3ed","#f6c90e","#fc8181","#c084fc","#fb923c","#67e8f9","#86efac","#fca5a5","#93c5fd","#d8b4fe","#fcd34d","#6ee7b7","#a5b4fc","#f9a8d4"];
