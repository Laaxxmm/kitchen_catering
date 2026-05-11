"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Role } from "@prisma/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  defaults?: { name?: string; email?: string; role?: Role; phone?: string | null; active?: boolean };
  requirePassword: boolean;
  onSubmit: (input: { email: string; name: string; role: Role; phone: string | null; password: string | undefined; active?: boolean }) => Promise<{ id?: string } | void>;
  submitLabel?: string;
  redirectOnSuccess?: string;
}

export function UserForm({ defaults, requirePassword, onSubmit, submitLabel = "Save", redirectOnSuccess }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [name, setName] = useState(defaults?.name ?? "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [role, setRole] = useState<Role>(defaults?.role ?? Role.SALES);
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(defaults?.active ?? true);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return toast.error("Name and email are required");
    if (requirePassword && !password) return toast.error("Password is required");
    startTransition(async () => {
      try {
        const result = await onSubmit({
          name, email, role,
          phone: phone || null,
          password: password || undefined,
          active,
        });
        toast.success("Saved");
        const targetId = result && "id" in result ? result.id : undefined;
        if (redirectOnSuccess && targetId) router.push(redirectOnSuccess.replace(":id", targetId));
        else router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="role">Role</Label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
            {Object.values(Role).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input id="phone" value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="password">{requirePassword ? "Password" : "Password (leave blank to keep)"}</Label>
        <Input id="password" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        <span className="text-[11px] text-ik-ink-3">Minimum 8 characters.</span>
      </div>
      {!requirePassword && (
        <label className="flex items-center gap-2 text-[12.5px] text-ik-ink-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
