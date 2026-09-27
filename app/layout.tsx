import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { currentUser } from "@/lib/data";
import { signOut } from "./actions";
import InstallApp from "@/components/InstallApp";

export const metadata: Metadata = {
  title: "SIGMORA Swing Desk",
  description: "Private setup scanner and discipline gate for India and US swing trades.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Swing Desk", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#06060b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let signedIn = false;
  try {
    signedIn = !!(await currentUser());
  } catch {
    signedIn = false;
  }
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@1&display=swap"
        />
      </head>
      <body>
        {signedIn && (
          <header className="top">
            <a href="/" className="brand">
              <img src="/icon-192.png" alt="" width={26} height={26} />
              <span>SIGMORA</span>
              <em>Swing Desk</em>
            </a>
            <Nav />
            <div className="sp row">
              <InstallApp />
              <a href="/settings" className="btn small icon-btn phone-only" aria-label="Settings" title="Settings">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
              </a>
              <form action={signOut}>
                <button className="btn small" type="submit" aria-label="Sign out"><span className="hide-sm">Sign out</span><span className="phone-only">⎋</span></button>
              </form>
            </div>
          </header>
        )}
        <main className={`wrap ${signedIn ? "with-tabs" : ""}`}>{children}</main>
        {signedIn && <Nav tabs />}
      </body>
    </html>
  );
}
