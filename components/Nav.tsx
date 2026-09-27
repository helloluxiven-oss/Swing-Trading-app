"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "Today"],
  ["/scan", "Scanner"],
  ["/journal", "Journal"],
  ["/portfolio", "Portfolio"],
  ["/settings", "Rules"],
] as const;

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {LINKS.map(([href, label]) => {
        const on = href === "/" ? path === "/" : path.startsWith(href) || (href === "/scan" && path.startsWith("/stock"));
        return (
          <Link key={href} href={href} className={on ? "on" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
