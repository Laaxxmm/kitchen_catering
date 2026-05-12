"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DeliveryStatus, PaymentMethod } from "@prisma/client";
import { Button } from "@/components/ui/button";

interface OTPPayload {
  otp: string;
  paymentCollected: boolean;
  paymentAmount?: string;
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
}

interface Props {
  status: DeliveryStatus;
  onDispatch: () => Promise<void>;
  onArrived: () => Promise<void>;
  onConfirmOTP: (payload: OTPPayload) => Promise<void>;
  onFail: (reason: string) => Promise<void>;
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "NEFT", label: "NEFT" },
  { value: "IMPS", label: "IMPS" },
  { value: "RTGS", label: "RTGS" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
];

export function MobileDeliveryControls({ status, onDispatch, onArrived, onConfirmOTP, onFail }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [collected, setCollected] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");

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

  function submitOTP() {
    if (collected) {
      const amt = Number(amount);
      if (!amount || isNaN(amt) || amt <= 0) {
        toast.error("Enter the amount you collected");
        return;
      }
    }
    call(() =>
      onConfirmOTP({
        otp,
        paymentCollected: collected,
        paymentAmount: collected ? amount : undefined,
        paymentMethod: collected ? method : undefined,
        paymentReference: collected ? reference.trim() || undefined : undefined,
      }),
    );
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

            {/* Payment-on-delivery */}
            <label className="mt-2 flex items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={collected}
                onChange={(e) => setCollected(e.target.checked)}
              />
              I collected payment at the door
            </label>

            {collected && (
              <div className="grid gap-2 rounded-md border border-brand-200 bg-brand-50 p-3">
                <label className="grid gap-1">
                  <span className="text-[11.5px] text-ik-ink-3">Amount collected (₹)</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-10 w-full rounded-md border border-ik-rule bg-white px-3 font-mono text-[15px]"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11.5px] text-ik-ink-3">Method</span>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    className="h-10 w-full rounded-md border border-ik-rule bg-white px-2 text-[13px]"
                  >
                    {METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[11.5px] text-ik-ink-3">Reference (UPI ref / cheque no / txn id)</span>
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Optional"
                    className="h-10 w-full rounded-md border border-ik-rule bg-white px-3 text-[13px]"
                  />
                </label>
              </div>
            )}

            <Button
              className="h-11 w-full"
              disabled={pending || otp.length !== 4}
              onClick={submitOTP}
            >
              Confirm delivery{collected ? " + record payment" : ""}
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
