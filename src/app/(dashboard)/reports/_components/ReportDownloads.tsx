"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ReportDef {
  key: string;
  title: string;
  desc: string;
  /** Snapshot reports ignore the date range. */
  ranged: boolean;
}

const REPORTS: ReportDef[] = [
  { key: "sales", title: "Sales & order P&L", desc: "Orders in the range with revenue, cost split and margin.", ranged: true },
  { key: "gst", title: "GST / tax summary", desc: "Output GST (sales invoices) + input GST (purchases), for filing.", ranged: true },
  { key: "stock", title: "Stock & procurement", desc: "Stock valuation + purchase orders + vendor bills.", ranged: true },
  { key: "payments", title: "Payments (AR / AP)", desc: "Everything outstanding — receivables and payables.", ranged: false },
];

/**
 * Excel report downloads. Pick a date range (applies to the ranged reports),
 * then download. Each opens the gated /api/export/<key> endpoint.
 */
export function ReportDownloads() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function href(r: ReportDef): string {
    if (!r.ranged) return `/api/export/${r.key}`;
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const q = qs.toString();
    return `/api/export/${r.key}${q ? `?${q}` : ""}`;
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <div className="grid gap-1">
          <label htmlFor="from" className="text-[11.5px] text-ik-ink-2">From</label>
          <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="to" className="text-[11.5px] text-ik-ink-2">To</label>
          <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]" />
        </div>
        <p className="text-[11.5px] text-ik-ink-3">
          Applies to the ranged reports. Leave blank for the last 90 days. Payments is a live snapshot.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 max-w-3xl">
        {REPORTS.map((r) => (
          <div key={r.key} className="flex flex-col justify-between gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
            <div>
              <div className="font-medium text-[14px] text-ik-ink">{r.title}</div>
              <div className="mt-1 text-[12.5px] text-ik-ink-2">{r.desc}</div>
            </div>
            <div>
              <a href={href(r)} download>
                <Button size="sm" variant="outline">Download Excel</Button>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
