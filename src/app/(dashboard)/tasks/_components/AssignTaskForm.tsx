"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TaskPriority } from "@prisma/client";
import { assignTask } from "@/server/actions/tasks";
import { isNextNavigationError } from "@/lib/next-error";
import { roleLabel } from "@/lib/role-labels";

interface AssignableUser {
  id: string;
  name: string;
  role: string;
}

interface TaskTemplate {
  id: string;
  title: string;
  description: string | null;
  active: boolean;
}

interface FormValues {
  assignedToId: string;
  templateId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  targetDate: string;
}

interface Props {
  users: AssignableUser[];
  templates: TaskTemplate[];
}

// 16-character ISO local datetime used by <input type="datetime-local">.
function defaultTarget(): string {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  // Strip seconds/ms for the input.
  return d.toISOString().slice(0, 16);
}

export function AssignTaskForm({ users, templates }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } =
    useForm<FormValues>({
      defaultValues: {
        assignedToId: "",
        templateId: "",
        title: "",
        description: "",
        priority: TaskPriority.NORMAL,
        targetDate: defaultTarget(),
      },
    });
  const [showDescription, setShowDescription] = useState(false);

  const templateId = watch("templateId");

  function onTemplate(id: string) {
    setValue("templateId", id);
    if (!id) return;
    const t = templates.find((x) => x.id === id);
    if (t) {
      setValue("title", t.title);
      if (t.description) {
        setValue("description", t.description);
        setShowDescription(true);
      }
    }
  }

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      try {
        const res = await assignTask({
          assignedToId: values.assignedToId,
          title: values.title.trim(),
          description: values.description.trim() || null,
          priority: values.priority,
          targetDate: values.targetDate,
          templateId: values.templateId || null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Task assigned");
        reset({
          assignedToId: "",
          templateId: "",
          title: "",
          description: "",
          priority: TaskPriority.NORMAL,
          targetDate: defaultTarget(),
        });
        setShowDescription(false);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not assign task");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="grid gap-3 rounded-[14px] border border-ik-rule bg-ik-card p-4 sm:p-5"
    >
      <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Assign a task</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="assignedToId">Assign to<span className="text-gold" aria-hidden> *</span></Label>
          <select
            id="assignedToId"
            {...register("assignedToId", { required: true })}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            <option value="">— Pick a user —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {roleLabel(u.role)}
              </option>
            ))}
          </select>
          {errors.assignedToId && (
            <span className="text-[11px] text-alert">Pick an assignee</span>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="templateId">From preset</Label>
          <select
            id="templateId"
            value={templateId}
            onChange={(e) => onTemplate(e.target.value)}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            <option value="">— No preset —</option>
            {templates
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="title">Task<span className="text-gold" aria-hidden> *</span></Label>
        <Input
          id="title"
          placeholder="e.g. Recount freezer A"
          {...register("title", { required: true, minLength: 2 })}
        />
        {errors.title && (
          <span className="text-[11px] text-alert">Title is required</span>
        )}
      </div>

      {showDescription ? (
        <div className="grid gap-1.5">
          <Label htmlFor="description">Details</Label>
          <Textarea id="description" rows={3} {...register("description")} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowDescription(true)}
          className="justify-self-start text-[11.5px] text-ik-ink-3 hover:text-brand"
        >
          + Add details
        </button>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="targetDate">Target by</Label>
          <input
            id="targetDate"
            type="datetime-local"
            {...register("targetDate", { required: true })}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="priority">Priority</Label>
          <select
            id="priority"
            {...register("priority")}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            <option value={TaskPriority.LOW}>Low</option>
            <option value={TaskPriority.NORMAL}>Normal</option>
            <option value={TaskPriority.HIGH}>High</option>
          </select>
        </div>
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Assigning…" : "Assign task"}
        </Button>
      </div>
    </form>
  );
}
