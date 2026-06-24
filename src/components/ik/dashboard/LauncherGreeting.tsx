import type { ReactNode } from "react";
import { formatIST } from "@/lib/time";

/**
 * The shared launcher header used on every role's dashboard — a calm
 * date/time line, then "Hi {firstName}" in the Emerald & Gold serif, an
 * optional one-line subtitle, and optional right-aligned actions. Replaces
 * the old "Welcome, {role}" PageHeader so every home reads the same.
 */
export function LauncherGreeting({
  firstName,
  subtitle,
  actions,
}: {
  firstName: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const greeting = formatIST(new Date(), "EEEE, d MMMM · h:mm a");
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-[12px] text-ik-ink-3">{greeting}</div>
        <h1 className="ik-page-title mt-0.5 font-serif text-[24px] leading-tight text-brand-700">Hi {firstName}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[12.5px] text-ik-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
