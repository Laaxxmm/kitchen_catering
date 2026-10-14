"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { StoreDepartment } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pill, type PillTone } from "@/components/ik/Pill";
import { SummaryStrip } from "@/components/ik/StatChips";
import { isNextNavigationError } from "@/lib/next-error";
import { applyDeptStockUpload, previewDeptStockUpload } from "@/server/actions/dept-stock-upload";
// Types only: the parser itself (and exceljs) stays on the server.
import type { RowStatus, UploadPlan } from "@/server/dept-stock-upload";

const STATUS: Record<RowStatus, { label: string; tone: PillTone }> = {
  NEW: { label: "New", tone: "blue" },
  UPDATE: { label: "Update", tone: "amber" },
  UNCHANGED: { label: "Unchanged", tone: "ink" },
  PROBLEM: { label: "Problem", tone: "alert" },
};

/**
 * Choose file → Preview → Apply. The preview is only for the user's eyes:
 * Apply sends the same file again and the server re-plans it, so nothing
 * the browser holds decides what is written.
 */
export function DeptStockUpload({ department }: { department: StoreDepartment }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<UploadPlan | null>(null);
  const [done, setDone] = useState<{ created: number; updated: number; unchanged: number } | null>(null);

  const slug = department === "HOUSEKEEPING" ? "housekeeping" : "maintenance";
  const formData = () => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    return fd;
  };

  function preview() {
    startTransition(async () => {
      try {
        const res = await previewDeptStockUpload(department, formData());
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setPlan(res);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Preview failed");
      }
    });
  }

  function apply() {
    startTransition(async () => {
      try {
        const res = await applyDeptStockUpload(department, formData());
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setDone({ created: res.created, updated: res.updated, unchanged: res.unchanged });
        setPlan(null);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        toast.success("Stock uploaded");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Upload failed");
      }
    });
  }

  const s = plan?.summary;
  const changes = s ? s.new + s.update : 0;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-md border border-ik-rule p-4 text-[13px]">
        <p className="text-ik-ink-2">
          Fill the template — one row per item, the quantity you have on the shelf today — then preview it. New
          names become new items with that opening stock; an existing item is set to the quantity in the file.
          Cost per unit is recorded on the opening receipt of new items.{" "}
          <a className="font-medium text-brand-700 underline" href={`/api/dept-stock-template/${slug}`}>
            Download the template
          </a>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPlan(null);
              setDone(null);
            }}
            className="block max-w-[280px] text-[12px] text-ik-ink-2 file:mr-3 file:rounded-md file:border file:border-ik-rule file:bg-ik-paper-alt file:px-2 file:py-1 file:text-[12px] file:font-medium"
          />
          <Button type="button" variant="outline" onClick={preview} disabled={!file || pending}>
            {pending && !plan ? "Reading…" : "Preview"}
          </Button>
          <Button type="button" onClick={apply} disabled={!plan || !s || s.problems > 0 || changes === 0 || pending}>
            {pending && plan ? "Applying…" : "Apply"}
          </Button>
          <span className="text-[11px] text-ik-ink-3">.csv · ≤ 1 MB · ≤ 2,000 rows · in Excel: Save As → CSV UTF-8</span>
        </div>
      </div>

      {done && (
        <p className="rounded-md border border-ik-rule bg-ik-card p-3 text-[13px]">
          Done — {done.created} new item{done.created === 1 ? "" : "s"}, {done.updated} updated, {done.unchanged}{" "}
          unchanged.
        </p>
      )}

      {plan && s && (
        <>
          <SummaryStrip
            chips={[
              { label: "New", value: s.new, tone: "ink" },
              { label: "Update", value: s.update, tone: s.update ? "amber" : "grey" },
              { label: "Unchanged", value: s.unchanged, tone: "grey" },
              { label: "Problems", value: s.problems, tone: s.problems ? "red" : "green" },
            ]}
          />
          {s.problems > 0 ? (
            <p className="text-[13px] text-alert">
              Fix the rows marked Problem in your file and preview again — nothing is applied while any remain.
            </p>
          ) : changes === 0 ? (
            <p className="text-[13px] text-ik-ink-2">Every row already matches — there is nothing to apply.</p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Row</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.rows.map((r) => (
                <TableRow key={r.line}>
                  <TableCell className="font-mono text-[12px]">{r.line}</TableCell>
                  <TableCell>{r.name || "—"}</TableCell>
                  <TableCell>{r.unit || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{r.qty ?? "—"}</TableCell>
                  <TableCell>
                    <Pill tone={STATUS[r.status].tone} size="sm">
                      {STATUS[r.status].label}
                    </Pill>
                  </TableCell>
                  <TableCell className={r.status === "PROBLEM" ? "text-alert" : "text-ik-ink-2"}>
                    {r.notes.join(" · ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
