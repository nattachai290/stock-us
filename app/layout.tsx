import "./globals.css";
export const metadata = { title: 'SASOM — สะสม', description: 'DCA portfolio tracker' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="th"><body>{children}</body></html>;
}
