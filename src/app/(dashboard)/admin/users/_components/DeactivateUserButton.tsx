"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResultWith } from "@/lib/action-result";

/**
 * Deactivate button that also surfaces the action's orphaned-work warning
 * (open tasks / active deliveries still assigned to the user) as a toast —
 * the generic ActionResultButton would swallow it.
 */
export function DeactivateUserButton({
  action,
}: {
  action: () => Promise<ActionResultWith<{ warning?: string }>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const res = await action();
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            if (res.warning) toast.warning(res.warning, { duration: 12000 });
            else toast.success("User deactivated");
            router.refresh();
          } catch (err) {
            if (isNextNavigationError(err)) throw err;
            toast.error(err instanceof Error ? err.message : "Something went wrong");
          }
        })
      }
    >
      Deactivate
    </Button>
  );
}
