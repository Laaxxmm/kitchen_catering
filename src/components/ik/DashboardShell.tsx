"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Icon } from "./Icon";
import { IK } from "./tokens";
import type { NavBadges } from "@/lib/nav-config";

// Responsive shell used by the (dashboard) layout. Owns the mobile-drawer
// state for the sidebar:
//   - mobile (< md):  sidebar slides in from the left when the hamburger
//                      is tapped; backdrop tap or link tap closes it; ESC
//                      also closes; horizontal scroll-locked while open
//   - desktop (md+):  sidebar is sticky at its fixed width, no drawer logic
//
// Wraps Sidebar + TopBar + main so that we don't have to thread state
// through the server-rendered layout.

interface Props {
  userName: string;
  userRole: string;
  navBadges?: NavBadges;
  topBarRight?: ReactNode;
  children: ReactNode;
}

export function DashboardShell({ userName, userRole, navBadges, topBarRight, children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close drawer on every route change (mobile UX nicety).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // ESC key closes drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Lock body scroll while drawer is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    if (drawerOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    <div
      // `ik-dashboard-shell` triggers the safe-area-inset top padding rule
      // in globals.css for Capacitor / mobile-WebView builds where the
      // system status bar would otherwise overlap our TopBar (Android
      // edge-to-edge defaults). Desktop browsers report env() = 0 so the
      // workaround only kicks in below 768px.
      className="ik-dashboard-shell flex min-h-screen"
      style={{
        background: "var(--ik-paper)",
        color: "var(--ik-ink)",
      }}
    >
      {/* Backdrop — only on mobile, only when drawer is open */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Sidebar
          - desktop (md+): static block in the flex flow, sticky-top, full
            content visible
          - mobile: fixed-positioned drawer that slides in from the left.
            `position: fixed` ignores the parent's safe-area padding, so
            we set its top via inline style to respect the Android system
            status bar; otherwise the wordmark would be hidden behind it. */}
      <div
        className={[
          "z-50",
          // desktop: in-flow, sticky, full height
          "md:sticky md:top-0 md:h-screen md:flex",
          // mobile: fixed off-screen until drawerOpen flips it
          "fixed bottom-0 left-0 transition-transform duration-200",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0",
          // Reset the safe-area inset on desktop so the sidebar starts at
          // top:0 (in-flow makes top irrelevant on md+ anyway).
          "md:!top-0",
        ].join(" ")}
        // Mobile-only: push the drawer below the system status bar.
        // The CSS variable falls back to 28px on non-notched Android
        // (where env() reports 0) and to the actual inset on notched.
        style={{
          top: "max(env(safe-area-inset-top), 28px)",
        }}
      >
        <Sidebar userName={userName} userRole={userRole} badges={navBadges} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title="Operations workspace"
          right={topBarRight}
          onMenuClick={() => setDrawerOpen(true)}
        />
        <main className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
          {children}
        </main>
      </div>
    </div>
  );
}

// Re-export icon to keep the dashboard layout import tree tight.
export { Icon, IK };
