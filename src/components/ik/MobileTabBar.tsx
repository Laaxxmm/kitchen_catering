"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

// Bottom tab bar per the Claude-Design handoff. Three tabs wired to real
// routes; Jobs/Me from the original mock are deferred until they have
// destinations we'd be proud to ship.

interface Tab {
  href: string;
  label: string;
  icon: IconName;
}

const TABS: Tab[] = [
  { href: "/punch", label: "Today", icon: "home" },
  { href: "/me", label: "Time", icon: "clock" },
  { href: "/profile", label: "Me", icon: "user" },
];

interface Props {
  tone?: "paper" | "ink";
}

export function MobileTabBar({ tone = "paper" }: Props) {
  const pathname = usePathname();
  const dark = tone === "ink";

  return (
    <nav
      className={
        "fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-lg justify-around px-4 pb-7 pt-2 " +
        (dark
          ? "bg-ik-ink border-t border-white/10 text-white"
          : "bg-ik-card border-t border-ik-rule text-ik-ink")
      }
    >
      {TABS.map((t, idx) => {
        const active = pathname === t.href;
        const activeColor = dark ? "text-brand-500" : "text-brand-700";
        const idleColor = dark ? "text-white/50" : "text-ik-ink-3";
        return (
          <Link
            key={`${t.href}-${idx}`}
            href={t.href}
            className={
              "flex flex-col items-center gap-[3px] px-3 py-[6px] font-ik-sans text-[10px] " +
              (active ? `font-semibold ${activeColor}` : `font-medium ${idleColor}`)
            }
            aria-current={active ? "page" : undefined}
          >
            <Icon name={t.icon} size={19} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
