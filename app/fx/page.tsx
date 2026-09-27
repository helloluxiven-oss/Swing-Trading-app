import Desk from "@/components/Desk";

export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: Promise<{ tf?: string; s?: string }> }) {
  return <Desk kind="fx" searchParams={searchParams} />;
}
