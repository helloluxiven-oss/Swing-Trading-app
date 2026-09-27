"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Top links on desktop; a bottom tab bar on phones (see .nav in globals.css).
const I = {
  today: <path d="M3 12l9-8 9 8M5 10v10h14V10" />,
  scan: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  journal: <><path d="M6 3h11a2 2 0 0 1 2 2v16l-4-2-4 2-4-2-3 1.5V5a2 2 0 0 1 2-2z" /><path d="M9 8h6M9 12h6" /></>,
  portfolio: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  crypto: <><circle cx="12" cy="12" r="9" /><path d="M9.5 8h4a2 2 0 0 1 0 4h-4zm0 4h4.5a2 2 0 0 1 0 4H9.5zM11 6v2m0 8v2" /></>,
  gold: <><path d="M4 18h16l-2-6H6z" /><path d="M8 12l1.5-5h5L16 12" /></>,
  rules: <><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="M9 12l2 2 4-4" /></>,
};

const LINKS = [
  ["/", "Today", I.today],
  ["/scan", "Scanner", I.scan],
  ["/fx", "FX", I.gold],
  ["/crypto", "Crypto", I.crypto],
  ["/journal", "Journal", I.journal],
  ["/portfolio", "Portfolio", I.portfolio],
  ["/settings", "Rules", I.rules],
] as const;

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map(([href, label, icon]) => {
        const on = href === "/" ? path === "/" : path.startsWith(href) || (href === "/scan" && path.startsWith("/stock"));
        return (
          <Link key={href} href={href} className={`${on ? "on" : ""} ${href === "/settings" ? "desk-only" : ""}`} aria-current={on ? "page" : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {icon}
            </svg>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
