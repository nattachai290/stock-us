"use client";
import { IconCheck, IconAlert, IconX } from "./icons";

// Replaces the tiny inline status text in the old header. Purely presentational —
// hooks into the existing `status` state / `msg()` timer without changing behavior.
export default function Snackbar({ status, onClose }: { status: string; onClose: () => void }) {
  if (!status) return null;
  const isWarn = /⚠|ไม่ได้|พลาด|ผิดพลาด/.test(status);
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 20,
        maxWidth: "calc(100vw - 32px)", width: 420,
        background: "#212B35", border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
        boxShadow: "var(--shadow)", color: "var(--ink)",
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", fontSize: 13,
        zIndex: 500,
      }}
    >
      <span style={{ color: isWarn ? "var(--warn)" : "var(--gain)", flexShrink: 0, display: "flex" }}>
        {isWarn ? <IconAlert /> : <IconCheck />}
      </span>
      <span style={{ flex: 1, wordBreak: "break-word" }}>{status}</span>
      <button onClick={onClose} aria-label="ปิด" style={{ background: "none", border: "none", color: "var(--faint)", cursor: "pointer", flexShrink: 0, display: "flex", padding: 4 }}>
        <IconX size={14} />
      </button>
    </div>
  );
}
