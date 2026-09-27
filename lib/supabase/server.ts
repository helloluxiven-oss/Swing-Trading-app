import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  return { url, key };
}

/** A Supabase client bound to the signed-in user's cookies. Row-level security does the rest. */
export async function db() {
  const store = await cookies();
  const { url, key } = env();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Server Components cannot set cookies; the proxy refreshes the session instead.
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {}
      },
    },
  });
}

/** The single email allowed into this app. Anyone else is signed straight back out. */
export const allowedEmail = () => (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
