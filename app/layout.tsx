import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { currentUser } from "@/lib/data";
import { signOut } from "./actions";

export const metadata: Metadata = {
  title: "Swing Desk",
  description: "Private setup scanner and discipline gate for India and US swing trades.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#07070d", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let signedIn = false;
  try {
    signedIn = !!(await currentUser());
  } catch {
    signedIn = false;
  }
  return (
    <html lang="en">
      <body>
        {signedIn && (
          <header className="top">
            <span className="brand"><i />Swing Desk</span>
            <Nav />
            <form action={signOut} className="sp">
              <button className="btn small" type="submit">Sign out</button>
            </form>
          </header>
        )}
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
