"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResultWith } from "@/lib/action-result";

/**
 * Inline "create group" form. Client-side so a refused create (duplicate
 * name, permissions) surfaces as a toast instead of silently doing nothing.
 */
export function GroupForm({
  onCreate,
}: {
  onCreate: (input: { name: string; description: string | null }) => Promise<ActionResultWith<{ id: string }>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function submit() {
    if (!name.trim()) {
      toast.error("Enter the group name");
      return;
    }
    startTransition(async () => {
      try {
        const res = await onCreate({ name: name.trim(), description: description.trim() || null });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Group created");
        setName("");
        setDescription("");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mb-6 grid max-w-xl gap-3 rounded-md border border-ik-rule bg-ik-card p-4"
    >
      <div className="grid gap-1">
        <Label htmlFor="name">Group name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="description">Description (optional)</Label>
        <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending}>Create group</Button>
      </div>
    </form>
  );
}
