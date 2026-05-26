import { Button } from "@/components/ui/button";

// Industrial-operations mobile header: orange brand square + lockup,
// initials avatar on the right, sign-out as an unobtrusive action.
// `tone` flips styling for the live (dark) state.

interface Props {
  userName: string;
  role: string;
  tone?: "paper" | "ink";
  onSignOut: () => Promise<void>;
}

export function MobileHeader({ userName, role, tone = "paper", onSignOut }: Props) {
  const initials = userName
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const dark = tone === "ink";

  return (
    <header
      className={
        "sticky top-0 z-40 " +
        (dark
          ? "bg-ik-ink text-white border-b border-white/10"
          : "bg-ik-paper text-ik-ink border-b border-ik-rule")
      }
    >
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] bg-brand-500">
            {/* Chef toque — matches the desktop mark. */}
            <svg width="18" height="18" viewBox="0 0 40 40">
              <circle cx="14" cy="20" r="5" fill="#fff" />
              <circle cx="20" cy="17" r="6" fill="#fff" />
              <circle cx="26" cy="20" r="5" fill="#fff" />
              <rect x="10" y="25" width="20" height="6.5" rx="1.6" fill="#fff" />
            </svg>
          </span>
          <div className="leading-[1.1]">
            <div className="font-ik-sans text-[13px] font-semibold tracking-[-0.01em]">
              Greenpath
            </div>
            <div
              className={
                "font-ik-mono text-[9px] font-semibold uppercase tracking-[0.05em] " +
                (dark ? "opacity-60" : "text-ik-ink-3")
              }
            >
              Site · v0.1
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={
              "flex h-9 w-9 items-center justify-center rounded-full font-ik-sans text-[12px] font-semibold " +
              (dark ? "bg-white/15 text-white" : "bg-ik-paper-alt text-ik-ink")
            }
            title={`${userName} · ${role}`}
          >
            {initials || "—"}
          </span>
          <form action={onSignOut}>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className={
                dark
                  ? "text-white/70 hover:text-white hover:bg-white/10"
                  : "text-ik-ink-3 hover:text-ik-ink"
              }
            >
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
