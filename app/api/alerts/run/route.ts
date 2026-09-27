// Called every minute by Supabase's scheduler (pg_cron) with a secret header.
// Without the right secret the database refuses to answer, so this route has
// nothing to give an outsider.

import { NextResponse } from "next/server";
import { runAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = req.headers.get("x-alert-secret");
  if (!secret) return NextResponse.json({ ok: false }, { status: 403 });
  const out = await runAlerts(secret);
  return NextResponse.json(out, { status: out.ok ? 200 : 403, headers: { "Cache-Control": "no-store" } });
}
