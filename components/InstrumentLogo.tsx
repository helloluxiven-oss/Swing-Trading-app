import type { Instrument } from "@/lib/instruments";

const FLAG: Record<string, string> = { USD: "us", EUR: "eu", GBP: "gb", JPY: "jp", AUD: "au", CAD: "ca", CHF: "ch", NZD: "nz" };
const COMMODITY: Record<string, string> = { XAUUSD: "gold", XAGUSD: "silver", USOIL: "oil", UKOIL: "oil", NATGAS: "gas" };

/**
 * The real mark for an instrument: the coin's logo, both countries' flags for a
 * forex pair (base in front), or a commodity icon. Bundled with the app.
 */
export default function InstrumentLogo({ inst, size = 36 }: { inst: Instrument; size?: number }) {
  const box = { width: size, height: size };
  if (inst.kind === "crypto") {
    return (
      <span className="ilogo" style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/logos/crypto/${inst.id.toLowerCase()}.svg`} alt="" width={size} height={size} />
      </span>
    );
  }
  if (COMMODITY[inst.id]) {
    return (
      <span className="ilogo" style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/logos/commodities/${COMMODITY[inst.id]}.svg`} alt="" width={size} height={size} />
      </span>
    );
  }
  const base = FLAG[inst.id.slice(0, 3)], quote = FLAG[inst.id.slice(3, 6)];
  const f = Math.round(size * 0.7);
  return (
    <span className="ilogo pair" style={box} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {quote && <img className="q" src={`/logos/flags/${quote}.svg`} alt="" width={f} height={f} style={{ width: f, height: f }} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {base && <img className="b" src={`/logos/flags/${base}.svg`} alt="" width={f} height={f} style={{ width: f, height: f }} />}
    </span>
  );
}
