// Download your journal or holdings as CSV (signed-in only — the proxy checks the session).
import { db } from "@/lib/supabase/server";

const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
};

export async function GET(_: Request, { params }: { params: Promise<{ what: string }> }) {
  const { what } = await params;
  const table = what === "trades" ? "trades" : what === "holdings" ? "holdings" : null;
  if (!table) return new Response("unknown export", { status: 404 });
  const supabase = await db();
  const { data, error } = await supabase.from(table).select("*").order("created_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500 });
  const rows = (data ?? []).map(({ user_id: _u, ...r }) => r);
  return new Response(csv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="swing-desk-${table}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
