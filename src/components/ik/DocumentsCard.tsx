"use client";
// TODO refactor: 212 lines — over 150-line soft cap. Split upload form from list table before Phase 1 wires uploads.

import { useRef, useState, useTransition } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { DocumentKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";

const KIND_LABELS: Record<DocumentKind, string> = {
  ORIGINAL: "Original document",
  SIGNED_COPY: "Signed copy",
  ATTACHMENT: "Attachment",
  PHOTO: "Photo",
  PROOF_OF_DELIVERY: "Proof of delivery",
};

export type DocumentRow = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  kind: DocumentKind;
  description: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsCard({
  documents,
  canManage,
  kindOptions,
  defaultKind,
  onUpload,
  onDelete,
}: {
  documents: DocumentRow[];
  canManage: boolean;
  kindOptions: DocumentKind[];
  defaultKind: DocumentKind;
  onUpload: (formData: FormData) => Promise<void>;
  onDelete: (documentId: string) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>(defaultKind);
  const [description, setDescription] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a file first");
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    if (description.trim()) fd.set("description", description.trim());
    startTransition(async () => {
      try {
        await onUpload(fd);
        toast.success(`Uploaded ${file.name}`);
        if (fileRef.current) fileRef.current.value = "";
        setDescription("");
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Upload failed");
      }
    });
  };

  const removeDoc = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        await onDelete(id);
        toast.success("Deleted");
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>
          {documents.length === 0
            ? "No documents yet."
            : `${documents.length} document${documents.length === 1 ? "" : "s"} attached`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        {documents.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">
                    {d.fileName}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {KIND_LABELS[d.kind]} · {formatBytes(d.fileSize)} ·
                    uploaded {d.uploadedAt}
                    {d.uploadedByName ? ` by ${d.uploadedByName}` : ""}
                  </div>
                  {d.description && (
                    <div className="mt-0.5 truncate text-[11px] text-slate-600">
                      {d.description}
                    </div>
                  )}
                </div>
                <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline">
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                </a>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => removeDoc(d.id, d.fileName)}
                    disabled={isPending}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form
            onSubmit={submit}
            className="rounded-md border border-slate-200 bg-slate-50/40 p-3"
          >
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Upload document
            </div>
            <div className="grid gap-2">
              <div>
                <Label className="mb-1 block text-[11px]">File</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  className="block w-full text-[12px] file:mr-3 file:rounded file:border file:border-ik-rule file:bg-ik-card file:px-2 file:py-1 file:text-[12px] file:font-medium hover:file:bg-ik-paper-alt"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  PDF, JPG, or PNG · up to 30 MB
                </p>
              </div>
              <div>
                <Label className="mb-1 block text-[11px]">Type</Label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as DocumentKind)}
                  className="h-8 w-full rounded border border-ik-rule bg-ik-card px-2 text-[12px] text-ik-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30"
                >
                  {kindOptions.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="mb-1 block text-[11px]">
                  Description (optional)
                </Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-8 text-[12px]"
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={isPending}
                className="self-start"
              >
                <Upload className="h-3.5 w-3.5" /> Upload
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
