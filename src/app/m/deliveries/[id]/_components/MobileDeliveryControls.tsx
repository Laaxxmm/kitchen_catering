"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DeliveryStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";

interface Props {
  status: DeliveryStatus;
  onDispatch: () => Promise<void>;
  onArrived: () => Promise<void>;
  onConfirmOTP: (otp: string) => Promise<void>;
  onFail: (reason: string) => Promise<void>;
}

export function MobileDeliveryControls({ status, onDispatch, onArrived, onConfirmOTP, onFail }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [otp, setOtp] = useState("");

  function call(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn();
        toast.success("Saved");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <div className="grid gap-3 text-[13px]">
      {status === DeliveryStatus.SCHEDULED && (
        <Button className="h-11 w-full" disabled={pending} onClick={() => call(onDispatch)}>
          Dispatch
        </Button>
      )}

      {(status === DeliveryStatus.DISPATCHED || status === DeliveryStatus.IN_TRANSIT) && (
        <>
          <Button className="h-11 w-full" variant="outline" disabled={pending} onClick={() => call(onArrived)}>
            Mark arrived
          </Button>
          <div className="grid gap-2">
            <label className="text-[11.5px] text-ik-ink-3">4-digit OTP from recipient</label>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="0000"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="h-12 w-full rounded-md border border-ik-rule bg-ik-card px-3 text-center font-mono text-[24px] tracking-widest"
            />
            <Button
              className="h-11 w-full"
              disabled={pending || otp.length !== 4}
              onClick={() => call(() => onConfirmOTP(otp))}
            >
              Confirm delivery
            </Button>
          </div>
        </>
      )}

      <Button
        className="h-11 w-full"
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
  );
}
