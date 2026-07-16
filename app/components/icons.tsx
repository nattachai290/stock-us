// Shared inline SVG icon set — stroke=currentColor, stroke-width 2.2, fill none, viewBox 0 0 24 24
import type React from "react";

const base: React.SVGProps<SVGSVGElement> = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" };

export const IconCheck = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M4 12l5 5L20 7"/></svg>
);

export const IconAlert = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
);

export const IconX = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M18 6 6 18M6 6l12 12"/></svg>
);

export const IconRefresh = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>
);
