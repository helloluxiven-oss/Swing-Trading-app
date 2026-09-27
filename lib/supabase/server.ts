import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ALLOWED_EMAIL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";

export function env() {
  return { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY };
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
export const allowedEmail = () => ALLOWED_EMAIL;
