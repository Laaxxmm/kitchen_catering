"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DeliveryStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  status: DeliveryStatus;
  onDispatch: () => Promise<void>;
  onArrived: () => Promise<void>;
  onConfirmOTP: (otp: string) => Promise<void>;
  onFail: (reason: string) => Promise<void>;
}

export function DeliveryControls({ status, onDispatch, onArrived, onConfirmOTP, onFail }: Props) {
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
          <div className="flex items-end gap-2">
            <div className="grid gap-1">
              <label className="text-[11.5px] text-ik-ink-3">4-digit OTP</label>
              <Input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="0000"
                inputMode="numeric"
                className="w-24 text-center font-mono text-[16px] tracking-widest"
              />
            </div>
            <Button disabled={pending || otp.length !== 4} onClick={() => call(() => onConfirmOTP(otp))}>
              Confirm delivery
            </Button>
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
