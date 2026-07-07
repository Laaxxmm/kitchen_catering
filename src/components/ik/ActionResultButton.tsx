"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/**
 * Button for calling a converted server action from a server component.
 *
 * A bare `<form action={shim}>` swallows the action's `{ ok: false, error }`
 * result — the click silently does nothing when the action refuses (e.g.
 * "Event date must be in the future"). This wrapper surfaces the error as a
 * toast and refreshes the route on success. Pass a bound "use server" shim
 * that RETURNS the action's result.
 */
export function ActionResultButton({
  action,
  children,
  variant,
  successMessage,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  variant?: "default" | "outline" | "ghost";
  successMessage?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const res = await action();
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            if (successMessage) toast.success(successMessage);
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Something went wrong");
          }
        })
      }
    >
      {children}
    </Button>
  );
}
