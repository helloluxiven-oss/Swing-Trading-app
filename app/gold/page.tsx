import { redirect } from "next/navigation";

// The gold desk now lives in Forex & Commodities, with XAU pinned first.
export default async function Gold({ searchParams }: { searchParams: Promise<{ tf?: string }> }) {
  const { tf } = await searchParams;
  redirect(`/fx?s=XAUUSD${tf ? `&tf=${tf}` : ""}`);
}
