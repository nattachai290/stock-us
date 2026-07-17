"use client";
import { useEffect } from "react";

// Bottom-sheet on mobile / centered modal on desktop (breakpoint in globals.css .sheet-*).
// Pure presentational wrapper — no business logic, just replaces the old raw
// fixed-position overlay divs used by every modal in the app.
export default function Sheet({ open, onClose, children, maxWidth = 420 }: { open: boolean; onClose: () => void; children: React.ReactNode; maxWidth?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet-panel" style={{ ["--sheet-max-width" as any]: `${maxWidth}px` }} onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  );
}
