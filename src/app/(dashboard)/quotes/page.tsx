import Link from "next/link";
import { QuoteStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listQuotes } from "@/server/actions/quotes";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

const STATUS_FILTERS: Array<{ key: string; label: string; statuses: QuoteStatus[] }> = [
  { key: "all", label: "All", statuses: [] },
  { key: "open", label: "Open", statuses: [QuoteStatus.DRAFT, QuoteStatus.SENT, QuoteStatus.CHANGES_REQUESTED, QuoteStatus.NEGOTIATING, QuoteStatus.REVISED] },
  { key: "accepted", label: "Accepted", statuses: [QuoteStatus.ACCEPTED] },
  { key: "converted", label: "Converted", statuses: [QuoteStatus.CONVERTED] },
  { key: "lost", label: "Lost / expired", statuses: [QuoteStatus.LOST, QuoteStatus.EXPIRED] },
];

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const sp = await searchParams;
  const filter = STATUS_FILTERS.find((f) => f.key === sp.filter) ?? STATUS_FILTERS[1];
  const quotes = await listQuotes(filter.statuses.length > 0 ? { status: filter.statuses } : {});

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Quotes"
        description="Draft a quote, share it with the customer, and convert to an order once they accept."
        actions={
          <Link href="/quotes/new">
            <Button>New quote</Button>
          </Link>
        }
      />

      <nav className="mb-4 flex gap-1 border-b border-ik-rule text-[13px]">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/quotes?filter=${f.key}`}
            className={
              "px-3 py-2 " +
              (f.key === filter.key
                ? "border-b-2 border-brand-500 font-medium text-ik-ink"
                : "text-ik-ink-2 hover:text-ik-ink")
            }
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {quotes.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No quotes in this view.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quote #</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Event</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((q) => (
              <TableRow key={q.id}>
                <TableCell>
                  <Link href={`/quotes/${q.id}`} className="font-mono text-brand hover:underline">
                    {q.quoteNo}
                  </Link>
                  {q.version > 1 && <span className="ml-1 text-[11px] text-ik-ink-3">v{q.version}</span>}
                </TableCell>
                <TableCell className="text-[12.5px]">{q.title}</TableCell>
                <TableCell>{q.customer.name}</TableCell>
                <TableCell className="font-mono text-[12px] text-ik-ink-2">
                  {q.eventDate ? formatIST(q.eventDate, "yyyy-MM-dd") : "—"}
                </TableCell>
                <TableCell className="text-right font-mono">{formatINR(q.grandTotal)}</TableCell>
                <TableCell><StatusBadge status={q.status} /></TableCell>
                <TableCell className="font-mono text-[12px] text-ik-ink-3">
                  {formatIST(q.createdAt, "yyyy-MM-dd")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
