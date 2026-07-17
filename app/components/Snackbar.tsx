"use client";
import { IconCheck, IconAlert, IconX } from "./icons";

// Replaces the tiny inline status text in the old header. Purely presentational —
// hooks into the existing `status` state / `msg()` timer without changing behavior.
// Position lives in globals.css (.snackbar): above the bottom tab bar on mobile,
// bottom-right on desktop (§4.3).
export default function Snackbar({ status, onClose }: { status: string; onClose: () => void }) {
  if (!status) return null;
  const isWarn = /⚠|ไม่ได้|พลาด|ผิดพลาด/.test(status);
  return (
    <div
      role="status"
      aria-live="polite"
      className="snackbar"
      style={{
        background: "#212B35", border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
        boxShadow: "var(--shadow)", color: "var(--ink)",
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", fontSize: 13,
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
