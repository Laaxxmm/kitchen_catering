import Link from "next/link";
import { listDocuments } from "@/server/actions/documents";
import type { DocumentEntityType } from "@prisma/client";
import { formatIST } from "@/lib/time";

/**
 * Server component that fetches + renders the documents attached to an
 * entity. Each row links to /api/documents/[id] which streams the file
 * back (inline disposition so PDFs open in a new tab, images render).
 */
export async function DocumentList({
  entityType,
  entityId,
  title = "Attachments",
  emptyText = "No files attached yet.",
}: {
  entityType: DocumentEntityType;
  entityId: string;
  title?: string;
  emptyText?: string;
}) {
  const docs = await listDocuments(entityType, entityId);
  return (
    <section className="rounded-md border border-ik-rule bg-ik-card">
      <header className="border-b border-ik-rule px-3 py-2 text-[12px] font-medium text-ik-ink-2">
        {title}
      </header>
      {docs.length === 0 ? (
        <p className="p-3 text-[12.5px] text-ik-ink-3">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-ik-rule">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]"
            >
              <Link
                href={`/api/documents/${d.id}`}
                target="_blank"
                className="min-w-0 truncate text-brand hover:underline"
              >
                {d.fileName}
              </Link>
              <span className="shrink-0 text-[10.5px] text-ik-ink-3">
                {Math.round(d.fileSize / 1024)} KB · {d.uploadedBy?.name ?? "—"} ·{" "}
                {formatIST(d.uploadedAt, "dd MMM")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
