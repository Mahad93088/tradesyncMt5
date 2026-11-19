export type CsvCell = string | number | boolean | null | undefined;

export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const str = String(value);
  const sanitized = /^[=+\-@\t\r]/.test(str) && Number.isNaN(Number(str)) ? `'${str}` : str;
  if (/[",\r\n]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

export function buildCsvContent(headers: string[], rows: CsvCell[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  return [headerLine, ...dataLines].join('\n');
}

export function downloadCsvFile(filename: string, headers: string[], rows: CsvCell[][]): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const csv = buildCsvContent(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function printCurrentReport(): void {
  if (typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
  }
}
