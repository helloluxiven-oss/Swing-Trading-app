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
              <form action={signOut}>
                <button className="btn small" type="submit">Sign out</button>
              </form>
            </div>
          </header>
        )}
        <main className={`wrap ${signedIn ? "with-tabs" : ""}`}>{children}</main>
      </body>
    </html>
  );
}
