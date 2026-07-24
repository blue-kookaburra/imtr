"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  {
    href: "/",
    label: "Map",
    icon: (
      // Simplified network glyph
      <path d="M4 18 10 12 14 12 20 6 M10 12 10 6 M14 12 14 18" />
    ),
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: (
      <path d="M5 5 H19 A1 1 0 0 1 20 6 V19 A1 1 0 0 1 19 20 H5 A1 1 0 0 1 4 19 V6 A1 1 0 0 1 5 5 Z M4 9.5 H20 M8 3.5 V6.5 M16 3.5 V6.5" />
    ),
  },
];

export default function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="shrink-0 border-t border-hairline bg-elevated/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      aria-label="Main"
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold tracking-wide uppercase transition-colors duration-150 ${
                active ? "text-accent" : "text-ink-faint hover:text-ink-dim"
              }`}
            >
              {active && (
                <span className="absolute top-0 h-0.5 w-10 rounded-full bg-accent" aria-hidden />
              )}
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {tab.icon}
              </svg>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
