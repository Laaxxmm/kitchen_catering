"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

const TONES = {
  danger: { box: "border-alert-wash bg-alert-wash", heading: "text-alert" },
  warning: { box: "border-amber-wash bg-amber-wash", heading: "text-amber" },
  brand: { box: "border-brand-200 bg-brand-50", heading: "text-brand-700" },
} as const;

interface Props {
  /** Bound "use server" shim that RETURNS the action's result. */
  action: (value: string) => Promise<ActionResult>;
  heading: string;
  submitLabel: string;
  successMessage: string;
  placeholder?: string;
  /** Refuse to submit with an empty field (default true). */
  required?: boolean;
  tone?: keyof typeof TONES;
  buttonVariant?: "default" | "outline";
}

/**
 * Boxed sidebar form with a single reason/note textarea, for converted
 * server actions called from a server component. A bare
 * `<form action={shim}>` swallows the action's `{ ok: false, error }`
 * result — this wrapper toasts the refusal, toasts success, and
 * refreshes the route (or lets a shim `redirect()` on success).
 */
export function ActionReasonForm({
  action,
  heading,
  submitLabel,
  successMessage,
  placeholder = "Reason",
  required = true,
  tone = "danger",
  buttonVariant = "outline",
}: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [value, setValue] = useState("");
  const palette = TONES[tone];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (required && !trimmed) {
      toast.error("Please enter a reason");
      return;
    }
    startTransition(async () => {
      try {
        const res = await action(trimmed);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(successMessage);
        setValue("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <form onSubmit={submit} className={`rounded-md border p-4 text-[13px] ${palette.box}`}>
      <h3 className={`mb-2 font-medium ${palette.heading}`}>{heading}</h3>
      <textarea
        rows={2}
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mb-2 w-full rounded border border-ik-rule bg-ik-card px-2 py-1 text-[12.5px]"
      />
      <Button type="submit" variant={buttonVariant} size="sm" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
