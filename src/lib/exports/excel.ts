import ExcelJS from "exceljs";

export interface SheetSpec {
  name: string;
  header?: string[];
  rows: Array<Array<string | number | Date | null | undefined>>;
  widths?: number[];
}

/**
 * Build a multi-sheet xlsx buffer. Header row is bold; auto-filter applied;
 * data rows applied as-is. Numbers stay numeric; strings stay strings;
 * Dates are written as Date objects (Excel formats them per locale).
 */
export async function buildWorkbook(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Green Park Eco Hotel";
  wb.created = new Date();

  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name.slice(0, 31));
    if (spec.header) {
      ws.addRow(spec.header);
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true };
      headerRow.commit();
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: spec.header.length },
      };
    }
    for (const row of spec.rows) {
      ws.addRow(row.map((v) => (v === undefined ? null : v)));
    }
    if (spec.widths) {
      spec.widths.forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
      });
    } else if (spec.header) {
      // Approximate auto-fit: max(header, 20) for each column.
      spec.header.forEach((h, i) => {
        ws.getColumn(i + 1).width = Math.max(12, Math.min(40, h.length + 4));
      });
    }
  }

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

export function xlsxResponse(buf: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
