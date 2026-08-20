"use client";
import { IconLock, IconRefresh, IconCheck } from "./icons";

// The signed-out screen. It is the only page a first-time visitor sees, so it carries
// the wordmark itself: the app bar hides its copy above 900px (the sidebar normally
// owns the brand there) and the sidebar does not exist until you are signed in —
// which left the desktop login screen with no branding at all.
const POINTS = [
  { Icon: IconLock, text: "ข้อมูลเก็บบน Google Drive ของคุณเอง" },
  { Icon: IconRefresh, text: "ซิงค์อัตโนมัติทุกเครื่องที่ล็อกอิน" },
  { Icon: IconCheck, text: "รองรับหลายพอร์ต แยกกันได้อิสระ" },
];

// Google's mark on the button that actually starts Google OAuth — the convention
// users look for to tell a real sign-in from a lookalike.
const GoogleMark = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-4H24v7.3h12.1c-.2 1.9-1.6 4.9-4.5 6.8l6.9 5.4c4.1-3.8 6.6-9.4 6.6-15.5z"/>
    <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z"/>
    <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.9l7.1-5.5z"/>
    <path fill="#EA4335" d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.3 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14.1l7.1 5.5c1.8-5.3 6.7-9.1 12.5-9.1z"/>
  </svg>
);

export default function LoginGate({ onLogin, loading }: { onLogin: () => void; loading: boolean }) {
  return (
    <div style={{
      // .app-body is a flex row (it hosts the sidebar when signed in) with
      // align-items:flex-start, so the gate has to claim the width and height itself
      // or it collapses to content size and pins to the left.
      position: "relative", flex: 1, width: "100%", minHeight: "100dvh",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px 20px", overflow: "hidden",
    }}>
      {/* Brass wash behind the card — the only decoration, and it never intercepts taps. */}
      <div aria-hidden="true" style={{
        position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: "min(720px, 150%)", height: 560, pointerEvents: "none",
        background: "radial-gradient(ellipse at center, rgba(210,174,108,0.13), rgba(210,174,108,0) 68%)",
      }}/>

      <div style={{
        position: "relative", width: "100%", maxWidth: 380, textAlign: "center",
        background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow)", padding: "38px 28px 30px",
      }}>
        <div style={{
          fontSize: 30, fontWeight: 800, letterSpacing: "0.16em", lineHeight: 1,
          fontFamily: '"Avenir Next",Futura,"Segoe UI",system-ui,sans-serif',
        }}>
          <span style={{ color: "var(--brass)" }}>SA</span><span style={{ color: "var(--ink)" }}>SOM</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 10, letterSpacing: "0.02em" }}>
          ติดตามพอร์ตหุ้น US · ราคาสด · วิเคราะห์ด้วย AI
        </div>

        <div style={{ height: 1, background: "var(--line)", margin: "24px 0" }}/>

        <button onClick={onLogin} disabled={loading} style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%",
          background: loading ? "var(--card2)" : "var(--brass)", color: loading ? "var(--mut)" : "var(--on-brass)",
          border: "none", borderRadius: "var(--r-md)", padding: "13px 18px",
          fontSize: 13.5, fontWeight: 700, cursor: loading ? "default" : "pointer",
          transition: "opacity 0.15s", opacity: loading ? 0.8 : 1,
        }}>
          {!loading && <GoogleMark/>}
          {loading ? "กำลังเชื่อมต่อ..." : "เชื่อมต่อด้วย Google"}
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 11, margin: "24px 2px 0", textAlign: "left" }}>
          {POINTS.map(({ Icon, text }, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "var(--brass)", flexShrink: 0, display: "flex" }}><Icon size={14}/></span>
              <span style={{ fontSize: 11.5, color: "var(--mut)", lineHeight: 1.45 }}>{text}</span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 24, lineHeight: 1.5 }}>
          Google OAuth · เข้าถึงเฉพาะไฟล์ที่แอปสร้างเอง
        </div>
      </div>
    </div>
  );
}
