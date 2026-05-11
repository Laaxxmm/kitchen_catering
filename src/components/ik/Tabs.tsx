"use client";

import type { ReactNode } from "react";
import { IK } from "./tokens";

// Underline-style tabs — accent underline on active, optional count badge.
// Source: handoff system.jsx · Tabs.

export interface TabItem {
  key: string;
  label: ReactNode;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange?: (key: string) => void;
}

export function Tabs({ items, active, onChange }: TabsProps) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {items.map((it) => {
        const isActive = it.key === active;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange?.(it.key)}
            style={{
              padding: "10px 14px",
              fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? IK.ink : IK.ink3,
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${isActive ? IK.accent : "transparent"}`,
              marginBottom: -1,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            {it.label}
            {it.count !== undefined && (
              <span
                style={{
                  fontFamily: "var(--font-ik-mono), ui-monospace, monospace",
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: isActive ? IK.accentWash : IK.paperAlt,
                  color: isActive ? IK.accentInk : IK.ink3,
                }}
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
