"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  vendor: { name: string; phone: string | null; email: string | null };
  poNo: string;
  messageText: string;
  emailSubject: string;
  receiveHref: string;
  onMarkSent: () => Promise<ActionResult | void>;
}

/**
 * "How do I tell the vendor?" block — surfaces the three things the user
 * actually wants after approving a PO:
 *
 *   1. Send on WhatsApp     → wa.me deep link with pre-filled text
 *   2. Send by email        → mailto: with subject + body filled in
 *   3. I told them another way → just flip status to SENT
 *
 * Clicking any of the three also marks the PO as SENT, so the dashboard
 * tile clears and the storekeeper knows a delivery is now expected.
 */
export function NotifyVendorBlock({
  vendor,
  poNo,
  messageText,
  emailSubject,
  receiveHref,
  onMarkSent,
}: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function markSent(after?: () => void) {
    startTransition(async () => {
      try {
        const res = await onMarkSent();
        if (res && !res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("PO marked as sent — waiting for delivery");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not mark sent");
        return;
      }
      after?.();
    });
  }

  const phoneDigits = vendor.phone ? vendor.phone.replace(/\D/g, "") : null;
  const waUrl = phoneDigits
    ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(messageText)}`
    : null;
  const mailUrl = vendor.email
    ? `mailto:${vendor.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(messageText)}`
    : null;

  return (
    <div className="rounded-md border border-brand-200 bg-brand-50 p-4">
      <h3 className="text-[14px] font-medium text-brand-700">Tell the supplier about this order</h3>
      <p className="mt-1 text-[12.5px] text-ik-ink-2">
        Pick one of the options below. Once the supplier knows, the PO is marked as <em>sent</em> and
        the storekeeper just waits for the delivery.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Button
          type="button"
          disabled={pending || !waUrl}
          className="h-11 w-full"
          onClick={() => {
            if (!waUrl) return;
            // Open WhatsApp first, then flip status. If popup blocked,
            // the message text is still copied to clipboard as a fallback.
            window.open(waUrl, "_blank", "noopener,noreferrer");
            navigator.clipboard?.writeText(messageText).catch(() => {});
            markSent();
          }}
          title={vendor.phone ?? "No phone on vendor"}
        >
          {waUrl ? "Send on WhatsApp" : "WhatsApp (no phone)"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !mailUrl}
          className="h-11 w-full"
          onClick={() => {
            if (!mailUrl) return;
            window.location.href = mailUrl;
            markSent();
          }}
          title={vendor.email ?? "No email on vendor"}
        >
          {mailUrl ? "Send by email" : "Email (no address)"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          className="h-11 w-full"
          onClick={() => markSent()}
        >
          I told them already
        </Button>
      </div>

      <details className="mt-3 text-[12.5px] text-ik-ink-2">
        <summary className="cursor-pointer text-ik-ink-3">Preview the message that will be sent</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded border border-ik-rule bg-ik-card p-2 font-mono text-[11.5px] text-ik-ink-2">
          {messageText}
        </pre>
      </details>

      <div className="mt-4 rounded border border-dashed border-ik-rule bg-ik-paper-alt p-3 text-[12.5px] text-ik-ink-2">
        <strong>When the goods arrive at the kitchen:</strong> the storekeeper opens this PO and presses
        the button below to record what was delivered. Stock updates automatically.
        <div className="mt-2">
          <Link href={receiveHref}>
            <Button size="sm" variant="outline">Goods arrived — log delivery</Button>
          </Link>
        </div>
        <div className="mt-1 text-[11px] text-ik-ink-3">PO {poNo} · supplier: {vendor.name}</div>
      </div>
    </div>
  );
}
