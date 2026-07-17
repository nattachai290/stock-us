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

export const IconGrid = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
);

export const IconBars = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>
);

export const IconClock = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
);

export const IconSpark = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>
);

export const IconDots = ({ size = 16 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
);

export const IconZap = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>
);

export const IconPaste = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M12 16V4m0 12-4-4m4 4 4-4"/><path d="M4 20h16"/></svg>
);

export const IconPencil = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M3 21v-4l14-14 4 4L7 21H3z"/></svg>
);

export const IconLightbulb = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3 11.2c.6.4 1 1.1 1 1.8v.5h4v-.5c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/></svg>
);

export const IconClipboard = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><rect x="6" y="4" width="12" height="17" rx="1.5"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6M9 15h6"/></svg>
);

export const IconArrowDown = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M12 5v14m0 0-5-5m5 5 5-5"/></svg>
);

export const IconArrowUp = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M12 19V5m0 0-5 5m5-5 5 5"/></svg>
);

export const IconSplit = ({ size = 16 }: { size?: number }) => (
  <svg {...base} width={size} height={size}><path d="M8 3H5v18h3M16 3h3v18h-3"/></svg>
);
