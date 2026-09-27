// Public configuration. None of these are secrets:
// - the Supabase URL and publishable key are sent to every browser by design;
//   the data is protected by row-level security, not by hiding the key;
// - the allowed email only says who may sign in; a password still guards it.
// Environment variables with the same names override these defaults.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://orcbpiuxflwveipcbwdw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_NBerTzjogYu_TgkiY26rNA_T63Y8cm3";
export const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL || "helloluxiven@gmail.com").trim().toLowerCase();
