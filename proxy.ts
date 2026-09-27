// Every page is private. This runs before each request: it refreshes the
// Supabase session cookie and sends anyone who is not the one allowed user to
// the login page.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ALLOWED_EMAIL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./lib/config";

const PUBLIC = ["/login", "/api/health", "/api/logo"];

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => res.headers.set(k, v));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const email = String(data?.claims?.email ?? "").toLowerCase();
  const allowed = ALLOWED_EMAIL;
  const signedIn = !!data?.claims && !!allowed && email === allowed;
  const isPublic = PUBLIC.some((p) => req.nextUrl.pathname.startsWith(p));

  if (!signedIn && !isPublic) {
    if (data?.claims) await supabase.auth.signOut(); // a valid session, but not the owner
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    return NextResponse.redirect(to);
  }
  if (signedIn && isPublic && req.nextUrl.pathname.startsWith("/login")) {
    const to = req.nextUrl.clone();
    to.pathname = "/";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sw.js|offline.html|manifest.webmanifest|.*\\.(?:png|svg|ico)$).*)"],
};
