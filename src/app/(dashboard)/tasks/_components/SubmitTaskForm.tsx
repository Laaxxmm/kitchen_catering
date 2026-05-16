"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitTask } from "@/server/actions/tasks";
import { isNextNavigationError } from "@/lib/next-error";

interface FormValues {
  completionRemarks: string;
  completedAt: string;
}

function defaultCompleted(): string {
  // Now, rounded to nearest minute, as ISO local for datetime-local input.
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function SubmitTaskForm({
  taskId,
  rejected,
}: {
  taskId: string;
  rejected?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    defaultValues: { completionRemarks: "", completedAt: defaultCompleted() },
  });

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      try {
        await submitTask({
          id: taskId,
          completionRemarks: values.completionRemarks.trim(),
          completedAt: values.completedAt,
        });
        toast.success(rejected ? "Resubmitted" : "Submitted for review");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not submit");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4"
    >
      <div className="text-[12px] font-medium text-ik-ink-2">
        {rejected ? "Resubmit task" : "Mark this task done"}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="completionRemarks">
          Remarks <span className="text-alert">*</span>
        </Label>
        <Textarea
          id="completionRemarks"
          rows={4}
          placeholder="What did you do? Any follow-ups? (required)"
          {...register("completionRemarks", { required: true, minLength: 3 })}
        />
        {errors.completionRemarks && (
          <span className="text-[11px] text-alert">
            Remarks are required (min 3 characters)
          </span>
        )}
      </div>

      <div className="grid gap-1.5 sm:max-w-xs">
        <Label htmlFor="completedAt">Done at</Label>
        <input
          id="completedAt"
          type="datetime-local"
          {...register("completedAt", { required: true })}
          className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
        />
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : rejected ? "Resubmit" : "Submit"}
        </Button>
      </div>
    </form>
  );
}
