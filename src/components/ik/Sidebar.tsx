"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { Wordmark } from "./Wordmark";
import { IK } from "./tokens";
import { istFyLabel } from "@/lib/time";
import { SIDEBAR_KEYS_BY_ROLE } from "@/lib/role-nav";
import { NAV_GROUPS, type NavItem, type NavBadges } from "@/lib/nav-config";
import { roleLabel } from "@/lib/role-labels";
import { NotificationBell } from "./NotificationBell";
import type { Role } from "@prisma/client";

// Left-rail app shell — 8 collapsible groups (see lib/nav-config.ts). The
// group containing the current page is open by default; others collapsed.
// Per-group "needs you" badges come from getNavBadges() (admin/manager).

interface SidebarProps {
  userName: string;
  userRole: string;
  badges?: NavBadges;
  footer?: ReactNode;
}

export function Sidebar({ userName, userRole, badges, footer }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname() ?? "/dashboard";

  // Per-role allowlist → only the groups/items this role may use.
  const allowedKeys = SIDEBAR_KEYS_BY_ROLE[userRole as Role] ?? new Set<string>();
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => allowedKeys.has(i.key)),
  })).filter((g) => g.items.length > 0);

  // Longest-prefix-wins so deep paths highlight the most specific item, and
  // remember which group that item lives in so it opens by default.
  let activeKey: string | null = null;
  let activeGroupKey: string | null = null;
  let activeHrefLen = -1;
  for (const g of groups) {
    for (const item of g.items) {
      const matches =
        pathname === item.href ||
        (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
      if (matches && item.href.length > activeHrefLen) {
        activeKey = item.key;
        activeGroupKey = g.key;
        activeHrefLen = item.href.length;
      }
    }
  }

  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(activeGroupKey ? [activeGroupKey] : []),
  );
  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  function renderItem(item: NavItem) {
    const active = item.key === activeKey;
    return (
      <Link
        key={item.key}
        href={item.href}
        title={collapsed ? item.label : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: collapsed ? "8px 9px" : "7px 10px",
          fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
          fontSize: 13,
          fontWeight: active ? 600 : 500,
          color: active ? IK.accentInk : IK.ink2,
          background: active ? IK.accentWash : "transparent",
          borderRadius: 4,
          textDecoration: "none",
          marginBottom: 1,
          borderLeft: active ? `2px solid ${IK.accent}` : "2px solid transparent",
        }}
      >
        <Icon name={item.icon} size={15} />
        {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
      </Link>
    );
  }

  const initials = userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const width = collapsed ? 60 : 236;

  return (
    <aside
      // Positioning is handled by DashboardShell (sticky on desktop, fixed
      // off-screen drawer on mobile). The aside itself only needs to fill
      // its container vertically and own its own width.
      style={{
        width,
        flex: "none",
        background: IK.card,
        borderRight: `1px solid ${IK.rule}`,
        display: "flex",
        flexDirection: "column",
        transition: "width .15s",
        height: "100vh",
      }}
    >
      <div
        style={{
          padding: collapsed ? "16px 12px" : "16px 18px",
          borderBottom: `1px solid ${IK.rule}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {collapsed ? (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: IK.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Chef's toque — same drawing as the full Wordmark mark.
                Background is the surrounding green square (this container
                already paints `IK.accent`), so we draw the toque alone. */}
            <svg width="22" height="22" viewBox="0 0 40 40">
              <circle cx="14" cy="20" r="5" fill="#fff" />
              <circle cx="20" cy="17" r="6" fill="#fff" />
              <circle cx="26" cy="20" r="5" fill="#fff" />
              <rect x="10" y="25" width="20" height="6.5" rx="1.6" fill="#fff" />
            </svg>
          </div>
        ) : (
          <Link href="/dashboard" style={{ textDecoration: "none" }}>
            <Wordmark size={14} />
          </Link>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: IK.ink3,
            padding: 4,
            display: collapsed ? "none" : "flex",
          }}
        >
          <Icon name="menu" size={14} />
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding: "12px 12px 8px" }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 10, top: 9, color: IK.ink3 }}>
              <Icon name="search" size={13} />
            </div>
            <input
              placeholder="Search or jump to…"
              style={{
                width: "100%",
                padding: "7px 10px 7px 30px",
                borderRadius: 4,
                border: `1px solid ${IK.rule}`,
                background: IK.paperAlt,
                fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
                fontSize: 12,
                color: IK.ink,
                outline: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                right: 8,
                top: 7,
                fontFamily: "var(--font-ik-mono), ui-monospace, monospace",
                fontSize: 10,
                color: IK.ink3,
                padding: "1px 5px",
                border: `1px solid ${IK.rule}`,
                borderRadius: 3,
              }}
            >
              ⌘K
            </div>
          </div>
        </div>
      )}

      <nav style={{ flex: 1, overflowY: "auto", padding: "4px 8px 12px" }}>
        {groups.map((g) => {
          // Collapsed rail, or a headerless group (Home): items flush, no toggle.
          if (collapsed || !g.label) {
            return <div key={g.key}>{g.items.map(renderItem)}</div>;
          }
          const open = openGroups.has(g.key);
          const badge = g.badgeKey ? badges?.[g.badgeKey] : undefined;
          return (
            <div key={g.key} style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                aria-expanded={open}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "6px 10px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-ik-mono), ui-monospace, monospace",
                  fontSize: 9.5,
                  color: IK.ink3,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  textAlign: "left",
                }}
              >
                <span style={{ flex: 1 }}>{g.label}</span>
                {badge && (
                  <span
                    style={{
                      fontFamily: "var(--font-ik-mono), ui-monospace, monospace",
                      fontSize: 9.5,
                      padding: "1px 5px",
                      borderRadius: 999,
                      background: badge.tone === "red" ? IK.alertWash : IK.amberWash,
                      color: badge.tone === "red" ? IK.alert : IK.amber,
                    }}
                  >
                    {badge.count}
                  </span>
                )}
                <span style={{ color: IK.ink4, fontSize: 11 }}>{open ? "▾" : "▸"}</span>
              </button>
              {open && <div>{g.items.map(renderItem)}</div>}
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <div
          style={{
            padding: 12,
            borderTop: `1px solid ${IK.rule}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 4,
              background: IK.accent,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {initials}
          </div>
          <div style={{ flex: 1, lineHeight: 1.2, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
                fontSize: 12,
                fontWeight: 600,
                color: IK.ink,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {userName}
            </div>
            <div
              className="ik-caps"
              style={{ fontSize: 9.5, letterSpacing: ".08em" }}
            >
              {roleLabel(userRole)} · {istFyLabel(new Date())}
            </div>
          </div>
          <NotificationBell />
          {footer}
        </div>
      )}
    </aside>
  );
}
