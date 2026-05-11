import type { ReactNode } from "react";
import { IK } from "./tokens";

// Editorial page header — eyebrow, display-weight title, optional description, actions + tabs row.
// Source: handoff system.jsx · PageHeader.

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions, tabs }: PageHeaderProps) {
  return (
    <div className="mb-5 md:mb-6">
      {/* Title row: stacks (title above actions) on mobile, side-by-side on
          desktop. Title shrinks from 26px to 20px below sm so common
          greetings like "Good afternoon, Kishore" fit on one line. */}
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-start md:gap-6">
        <div className="min-w-0">
          {eyebrow && (
            <div
              className="ik-eyebrow"
              style={{ fontSize: 10, marginBottom: 6 }}
            >
              {eyebrow}
            </div>
          )}
          <h1
            className="ik-page-title"
            style={{
              fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
              fontSize: 26,
              fontWeight: 600,
              color: IK.ink,
              letterSpacing: "-0.025em",
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            {title}
          </h1>
          {description && (
            <div
              style={{
                fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
                fontSize: 13,
                color: IK.ink3,
                marginTop: 6,
                maxWidth: 640,
              }}
            >
              {description}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 md:flex-none">{actions}</div>
        )}
      </div>
      {tabs && <div style={{ marginTop: 20, borderBottom: `1px solid ${IK.rule}` }}>{tabs}</div>}
    </div>
  );
}
