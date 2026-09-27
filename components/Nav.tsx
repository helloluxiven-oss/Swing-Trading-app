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
  rules: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
};

const LINKS = [
  ["/", "Today", I.today],
  ["/scan", "Stocks", I.scan],
  ["/fx", "FX", I.gold],
  ["/crypto", "Crypto", I.crypto],
  ["/journal", "Journal", I.journal],
  ["/portfolio", "Portfolio", I.portfolio],
  ["/settings", "Settings", I.rules],
] as const;

/** `tabs` renders the phone tab bar (outside the sticky header, so it can stay fixed while you scroll). */
export default function Nav({ tabs = false }: { tabs?: boolean }) {
  const path = usePathname();
  return (
    <nav className={tabs ? "nav tabs" : "nav top-nav"} aria-label={tabs ? "Main (tabs)" : "Main"}>
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
