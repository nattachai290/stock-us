import "./globals.css";
import type { Viewport } from "next";
export const metadata = { title: 'SASOM — สะสม', description: 'DCA portfolio tracker' };
// <meta name="color-scheme" content="dark">: the page is already dark, so mobile browsers'
// own "dark mode for websites" (Samsung Internet, Chrome auto-dark) must not darken it
// again — it turned chart bars near-black. The CSS `color-scheme` alone isn't honoured by all.
export const viewport: Viewport = { colorScheme: "dark" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="th" style={{ colorScheme: "dark" }}><body>{children}</body></html>;
}
