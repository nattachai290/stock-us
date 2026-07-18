"use client";
import { useEffect } from "react";

// Bottom-sheet on mobile / centered modal on desktop (breakpoint in globals.css .sheet-*).
// Pure presentational wrapper — no business logic, just replaces the old raw
// fixed-position overlay divs used by every modal in the app.
//
// dismissOnScrim: whether tapping the backdrop closes the sheet. Data-entry
// modals (buy/sell/split/edit) pass false so a stray outside click can't wipe
// half-typed input; Escape and the explicit ยกเลิก button always still close.
export default function Sheet({ open, onClose, children, maxWidth = 420, dismissOnScrim = true }: { open: boolean; onClose: () => void; children: React.ReactNode; maxWidth?: number; dismissOnScrim?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-scrim" onClick={dismissOnScrim ? onClose : undefined}>
      <div className="sheet-panel" style={{ ["--sheet-max-width" as any]: `${maxWidth}px` }} onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  );
}
