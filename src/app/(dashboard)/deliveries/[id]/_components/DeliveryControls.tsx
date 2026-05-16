"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DeliveryStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";

interface Props {
  status: DeliveryStatus;
  onDispatch: () => Promise<void>;
  onArrived: () => Promise<void>;
  /** OTP-less confirm. Name kept for backwards compat with the page shim. */
  onConfirmOTP: () => Promise<void>;
  onFail: (reason: string) => Promise<void>;
}

export function DeliveryControls({ status, onDispatch, onArrived, onConfirmOTP, onFail }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function call(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn();
        toast.success("Saved");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  return (
    <div className="grid gap-3 text-[13px]">
      {status === DeliveryStatus.SCHEDULED && (
        <div>
          <Button disabled={pending} onClick={() => call(onDispatch)}>Dispatch</Button>
        </div>
      )}
      {(status === DeliveryStatus.DISPATCHED || status === DeliveryStatus.IN_TRANSIT) && (
        <>
          <div>
            <Button variant="outline" disabled={pending} onClick={() => call(onArrived)}>Mark arrived</Button>
          </div>
          <div>
            <Button disabled={pending} onClick={() => call(onConfirmOTP)}>
              Confirm delivery
            </Button>
            <p className="mt-1 text-[11.5px] text-ik-ink-3">
              On confirmation, the GST tax invoice is auto-generated and emailed to the customer.
            </p>
          </div>
        </>
      )}
      <div className="border-t border-ik-rule pt-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            const reason = prompt("Reason for failure?");
            if (reason && reason.trim()) call(() => onFail(reason.trim()));
          }}
        >
          Mark failed
        </Button>
      </div>
    </div>
  );
}
