"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deactivateTaskTemplate,
  upsertTaskTemplate,
} from "@/server/actions/tasks";
import { EmptyState } from "@/components/ik/FormKit";
import { isNextNavigationError } from "@/lib/next-error";

interface Template {
  id: string;
  title: string;
  description: string | null;
  active: boolean;
}

export function TemplateManager({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ title: "", description: "" });

  function addPreset() {
    if (draft.title.trim().length < 2) {
      toast.error("Title is required (min 2 chars)");
      return;
    }
    startTransition(async () => {
      try {
        const res = await upsertTaskTemplate({
          title: draft.title.trim(),
          description: draft.description.trim() || null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Preset added");
        setDraft({ title: "", description: "" });
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function deactivate(id: string) {
    startTransition(async () => {
      try {
        const res = await deactivateTaskTemplate(id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Preset deactivated");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  function reactivate(t: Template) {
    startTransition(async () => {
      try {
        const res = await upsertTaskTemplate({
          id: t.id,
          title: t.title,
          description: t.description,
          active: true,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Preset reactivated");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Add preset</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title<span className="text-gold" aria-hidden> *</span></Label>
            <Input
              id="title"
              placeholder="e.g. Daily fridge temp check"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="description">Details</Label>
            <Textarea
              id="description"
              rows={2}
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </div>
        </div>
        <div>
          <Button onClick={addPreset} disabled={pending}>
            {pending ? "Saving…" : "Add preset"}
          </Button>
        </div>
      </section>

      <section>
        {templates.length === 0 ? (
          <EmptyState
            title="No presets yet"
            body="Presets are reusable task templates — add common recurring jobs (fridge temp checks, daily counts) once, then assign them in a click."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.title}</TableCell>
                  <TableCell className="text-[12.5px] text-ik-ink-2">
                    {t.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        "text-[11px] " +
                        (t.active ? "text-positive" : "text-ik-ink-3")
                      }
                    >
                      {t.active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {t.active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deactivate(t.id)}
                        disabled={pending}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reactivate(t)}
                        disabled={pending}
                      >
                        Reactivate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
