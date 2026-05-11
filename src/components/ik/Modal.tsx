"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";
import { IK } from "./tokens";

// Dialog shell with scrim + ESC-to-close.
// Source: handoff system.jsx · Modal.

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  width?: number;
}

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  actions,
  children,
  width = 720,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,18,14,.45)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "48px 24px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: IK.card,
          borderRadius: 6,
          width: "100%",
          maxWidth: width,
          boxShadow: "0 24px 60px rgba(0,0,0,.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "18px 24px",
            borderBottom: `1px solid ${IK.rule}`,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            {eyebrow && (
              <div className="ik-eyebrow" style={{ marginBottom: 4 }}>
                {eyebrow}
              </div>
            )}
            <div
              style={{
                fontFamily: "var(--font-ik-sans), Inter Tight, system-ui, sans-serif",
                fontSize: 18,
                fontWeight: 600,
                color: IK.ink,
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {actions}
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "transparent",
                border: `1px solid ${IK.rule}`,
                borderRadius: 4,
                padding: 6,
                cursor: "pointer",
                color: IK.ink3,
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
        <div style={{ padding: "20px 24px" }}>{children}</div>
      </div>
    </div>
  );
}
