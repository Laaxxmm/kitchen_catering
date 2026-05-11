"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Row { key: string; value: unknown; notes: string | null; updatedAt: string }

interface Props {
  rows: Row[];
  onSave: (key: string, value: unknown, notes: string | null) => Promise<void>;
}

function classify(v: unknown): "bool" | "number" | "string" | "json" {
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  return "json";
}

export function SettingsEditor({ rows, onSave }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  function save(key: string, value: unknown, notes: string | null) {
    startTransition(async () => {
      try {
        await onSave(key, value, notes);
        toast.success(`Saved ${key}`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function newSetting(e: React.FormEvent) {
    e.preventDefault();
    if (!newKey.trim()) return toast.error("Key required");
    let parsed: unknown;
    try {
      parsed = JSON.parse(newValue);
    } catch {
      parsed = newValue;
    }
    save(newKey.trim(), parsed, null);
    setNewKey("");
    setNewValue("");
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        {rows.map((r) => (
          <SettingRow key={r.key} row={r} pending={pending} onSave={save} />
        ))}
      </div>

      <form onSubmit={newSetting} className="rounded-md border border-ik-rule bg-ik-card p-4 max-w-2xl">
        <h3 className="mb-3 font-medium text-[14px] text-ik-ink">Add setting</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input placeholder="key (e.g. delivery.otpProvider)" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <Input placeholder='value (JSON: "console" or 5 or true)' value={newValue} onChange={(e) => setNewValue(e.target.value)} />
        </div>
        <div className="mt-3">
          <Button type="submit" size="sm" disabled={pending}>Create / overwrite</Button>
        </div>
      </form>
    </div>
  );
}

function SettingRow({ row, pending, onSave }: { row: Row; pending: boolean; onSave: (key: string, value: unknown, notes: string | null) => void }) {
  const kind = classify(row.value);
  const [v, setV] = useState(() => (kind === "json" ? JSON.stringify(row.value) : String(row.value ?? "")));

  function commit() {
    let parsed: unknown;
    if (kind === "bool") parsed = v === "true";
    else if (kind === "number") parsed = Number(v);
    else if (kind === "string") parsed = v;
    else {
      try { parsed = JSON.parse(v); } catch { return; }
    }
    onSave(row.key, parsed, row.notes);
  }

  return (
    <div className="grid grid-cols-1 items-center gap-2 rounded-md border border-ik-rule bg-ik-card p-3 sm:grid-cols-[1fr_2fr_auto]">
      <div>
        <div className="font-mono text-[12.5px] font-medium">{row.key}</div>
        <div className="text-[11px] text-ik-ink-3">type: {kind}</div>
      </div>
      <div>
        {kind === "bool" ? (
          <select value={v} onChange={(e) => setV(e.target.value)} className="h-9 w-full rounded-md border border-ik-rule bg-ik-paper-alt px-2 text-[13px]">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : kind === "number" ? (
          <Input type="number" step="any" value={v} onChange={(e) => setV(e.target.value)} />
        ) : kind === "string" ? (
          <Input value={v} onChange={(e) => setV(e.target.value)} />
        ) : (
          <Input value={v} onChange={(e) => setV(e.target.value)} className="font-mono text-[12px]" />
        )}
      </div>
      <Button size="sm" disabled={pending} onClick={commit}>Save</Button>
    </div>
  );
}
