import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { IK } from "./tokens";

// 48px top strip above the page content. Shows FY pill + notifications + optional right-side actions.
// Source: handoff shell.jsx · TopBar.

interface TopBarProps {
  title: ReactNode;
  right?: ReactNode;
  /**
   * Callback fired when the mobile hamburger is tapped. Set by
   * DashboardShell on mobile breakpoints; rendered as a button on
   * the left of the bar (visible only below `md`).
   */
  onMenuClick?: () => void;
}

export function TopBar({ title, right, onMenuClick }: TopBarProps) {
  return (
    <div
      className="flex h-12 flex-none items-center justify-between gap-2 px-3 md:px-5"
      style={{
        borderBottom: `1px solid ${IK.rule}`,
        background: IK.card,
      }}
    >
      <div className="flex min-w-0 items-center gap-2 md:gap-3.5">
        {onMenuClick && (
          // Hamburger button — mobile only. Tapped → DashboardShell opens
          // the sidebar drawer.
          <button
            type="button"
            aria-label="Open navigation menu"
            onClick={onMenuClick}
            className="-ml-1 flex h-9 w-9 flex-none items-center justify-center rounded-md md:hidden"
            style={{ color: IK.ink, background: "transparent" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}

        <div
          className="hidden ik-caps md:block"
          style={{ fontSize: 10.5, letterSpacing: ".08em" }}
        >
          Indefine
        </div>
        <div
          className="hidden md:block"
          style={{ width: 1, height: 14, background: IK.rule, flex: "none" }}
        />
        <div
          className="truncate text-[13px] font-medium"
          style={{
            fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
            color: IK.ink,
          }}
        >
          {title}
        </div>
      </div>

      <div className="flex flex-none items-center gap-1.5 md:gap-2">
        <div
          className="hidden items-center gap-1.5 sm:flex"
          style={{
            padding: "5px 10px",
            border: `1px solid ${IK.rule}`,
            borderRadius: 4,
            fontFamily: "var(--font-ik-mono), ui-monospace, monospace",
            fontSize: 11,
            color: IK.ink,
            background: IK.paperAlt,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 6, background: IK.positive }} />
          FY 25-26
        </div>
        <button
          type="button"
          aria-label="Notifications"
          style={{
            padding: 7,
            background: "transparent",
            border: `1px solid ${IK.rule}`,
            borderRadius: 4,
            cursor: "pointer",
            color: IK.ink3,
            position: "relative",
          }}
        >
          <Icon name="bell" size={14} />
          <span
            style={{
              position: "absolute",
              top: 3,
              right: 3,
              width: 6,
              height: 6,
              borderRadius: 6,
              background: IK.accent,
            }}
          />
        </button>
        {right}
      </div>
    </div>
  );
}
