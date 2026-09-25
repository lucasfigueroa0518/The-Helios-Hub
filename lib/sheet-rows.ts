import ExcelJS from 'exceljs';

export type SheetTable = {
  sheetName: string;
  rows: Record<string, string>[];
};

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join('');
  }
  if ('text' in value && value.text != null) return cellText(value.text);
  if ('result' in value && value.result != null) return cellText(value.result);
  if ('hyperlink' in value) {
    const link = value as ExcelJS.CellHyperlinkValue;
    return String(link.text ?? link.hyperlink ?? '');
  }
  return '';
}

function rowRecord(row: ExcelJS.Row, headers: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    if (!header) return;
    record[header] = cellText(row.getCell(index + 1).value);
  });
  return record;
}

/** Parse an .xlsx workbook into header-keyed row objects (first row = headers). */
export async function rowsFromXlsx(bytes: Buffer | ArrayBuffer): Promise<SheetTable[]> {
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  await workbook.xlsx.load(buffer as any);
  const sheets: SheetTable[] = [];
  workbook.eachSheet((worksheet) => {
    const headerRow = worksheet.getRow(1);
    const columnCount = Math.max(worksheet.actualColumnCount, headerRow.cellCount);
    const headers: string[] = [];
    for (let col = 1; col <= columnCount; col += 1) {
      headers.push(cellText(headerRow.getCell(col).value).trim());
    }
    if (!headers.some(Boolean)) return;
    const rows: Record<string, string>[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      rows.push(rowRecord(row, headers));
    });
    sheets.push({ sheetName: worksheet.name, rows });
  });
  return sheets;
}
