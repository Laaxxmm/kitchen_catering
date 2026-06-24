"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { IK } from "./tokens";

/**
 * Light/dark theme switch. Toggles `.dark` on <html> and persists the choice
 * to localStorage under "ik.theme". The no-flash inline script in layout.tsx
 * applies the saved theme before first paint; this button just keeps the
 * class + storage in sync and reflects the current state in its icon.
 */
export function ThemeToggle() {
  // Start from whatever the no-flash script already set on <html>.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem("ik.theme", next ? "dark" : "light");
    } catch {
      // private mode / storage disabled — preference just won't persist
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      style={{
        display: "grid",
        placeItems: "center",
        width: 30,
        height: 30,
        padding: 0,
        background: "transparent",
        border: `1px solid ${IK.rule}`,
        borderRadius: 4,
        cursor: "pointer",
        color: IK.ink3,
      }}
    >
      {dark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
