"use client";

import { useMemo, useState } from "react";
import { BanquetItemSource } from "@prisma/client";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { BANQUET_SOURCE_LABELS, banquetItemLabel } from "@/lib/stock-movement";

export interface BanquetPickerItem {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
  source: BanquetItemSource;
  /** In-house: Disposables / Crockery. Hired: Regulars / Melamine / Bonechina. */
  category: string | null;
  /** Hire charge or purchase rate per unit, already stringified. */
  rate: string | null;
  /** Omitted where on-hand is irrelevant — a receipt books stock IN. */
  currentStock?: string;
}

const SOURCES = [BanquetItemSource.IN_HOUSE, BanquetItemSource.HIRED] as const;

/**
 * Source first, then the item. The two catalogues are genuinely separate
 * lists that happen to share names, so narrowing by source before searching
 * is what makes the 154-item in-house list usable and what stops a hired
 * item being issued as if it were owned stock.
 */
export function BanquetItemPicker({
  id,
  items,
  value,
  onChange,
  label = "Item",
  disabled,
}: {
  id: string;
  items: BanquetPickerItem[];
  value: string;
  onChange: (itemId: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const selected = items.find((i) => i.id === value);
  const [source, setSource] = useState<BanquetItemSource>(
    selected?.source ?? BanquetItemSource.IN_HOUSE,
  );

  const options: ComboOption[] = useMemo(
    () =>
      items
        .filter((i) => i.source === source)
        .map((i) => ({ value: i.id, label: banquetItemLabel(i) })),
    [items, source],
  );

  return (
    <div className="grid gap-2 sm:grid-cols-[150px,1fr]">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-source`}>Source</Label>
        <select
          id={`${id}-source`}
          value={source}
          disabled={disabled}
          onChange={(e) => {
            setSource(e.target.value as BanquetItemSource);
            // The picked item belongs to the old list — keeping it would show
            // one source and submit the other.
            onChange("");
          }}
          className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {BANQUET_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Combobox
          id={id}
          value={value}
          onChange={onChange}
          options={options}
          disabled={disabled}
          placeholder="Search by code, name, grade…"
          emptyText={`No ${BANQUET_SOURCE_LABELS[source].toLowerCase()} item matches`}
        />
      </div>
    </div>
  );
}
