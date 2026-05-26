"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DocumentEntityType, DocumentKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { uploadDocument } from "@/server/actions/documents";
import { isNextNavigationError } from "@/lib/next-error";

/**
 * Client-side file uploader for the Document model.
 * Reads the file into memory, base64-encodes it, and pipes through the
 * uploadDocument server action. PDFs + JPEGs + PNGs only (magic-byte
 * sniffed server-side; the client MIME header is ignored).
 *
 * Renders an inline button + selected-file preview. Used on:
 *   - vendor bill form (entityType=VENDOR_BILL)
 *   - petty cash voucher form (entityType=PETTY_CASH_VOUCHER)
 */
interface Props {
  entityType: DocumentEntityType;
  entityId: string;
  kind?: DocumentKind;
  label?: string;
  /** Called after a successful upload — parent can refresh its list. */
  onUploaded?: () => void;
}

const MAX_MB = 10;
const ACCEPT = "application/pdf,image/jpeg,image/png";

export function DocumentUploader({
  entityType,
  entityId,
  kind = DocumentKind.ATTACHMENT,
  label = "Upload bill copy",
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<File | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > MAX_MB * 1024 * 1024) {
      toast.error(`File too large (max ${MAX_MB} MB)`);
      e.target.value = "";
      setSelected(null);
      return;
    }
    setSelected(f);
  }

  async function upload() {
    if (!selected) return;
    const buf = await selected.arrayBuffer();
    // base64 in the browser — chunked to avoid the 64KB call-stack
    // limit on very large arrays.
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, i + chunk)),
      );
    }
    const base64 = btoa(binary);
    startTransition(async () => {
      try {
        await uploadDocument({
          entityType,
          entityId,
          base64,
          fileName: selected.name,
          kind,
        });
        toast.success("Uploaded");
        setSelected(null);
        if (inputRef.current) inputRef.current.value = "";
        if (onUploaded) onUploaded();
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Upload failed");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onPick}
        className="block max-w-[260px] text-[12px] text-ik-ink-2 file:mr-3 file:rounded-md file:border file:border-ik-rule file:bg-ik-paper-alt file:px-2 file:py-1 file:text-[12px] file:font-medium file:text-ik-ink-2 hover:file:bg-brand-50"
      />
      {selected && (
        <span className="text-ik-ink-3">
          {(selected.size / 1024).toFixed(0)} KB
        </span>
      )}
      <Button
        type="button"
        size="sm"
        onClick={upload}
        disabled={!selected || pending}
      >
        {pending ? "Uploading…" : label}
      </Button>
      <span className="text-[10.5px] text-ik-ink-3">
        PDF / JPEG / PNG · ≤{MAX_MB} MB
      </span>
    </div>
  );
}
