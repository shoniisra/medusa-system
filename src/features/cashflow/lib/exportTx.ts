/**
 * Export de transacciones y resúmenes a CSV, Excel (.xls) y PDF.
 *
 * - CSV: UTF-8 con BOM para que Excel lo abra bien con acentos.
 * - Excel: tabla HTML servida como `.xls`. Excel 2003+ la abre nativa; evita
 *   agregar una lib pesada tipo SheetJS solo para esto.
 * - PDF: ventana imprimible — el usuario elige "Guardar como PDF" desde el
 *   diálogo de impresión del navegador.
 */

export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number;
};

export type ExportFormat = 'csv' | 'xls' | 'pdf';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Un pequeño delay evita que algunos navegadores aborten el download al
  // revocar la URL demasiado rápido.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escCsv(v: string | number): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escHtml(v: string | number): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const head = columns.map((c) => escCsv(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escCsv(c.value(r))).join(','));
  return [head, ...body].join('\r\n');
}

function toXlsHtml<T>(
  title: string,
  rows: T[],
  columns: ExportColumn<T>[],
): string {
  const head = columns
    .map((c) => `<th>${escHtml(c.header)}</th>`)
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => `<td>${escHtml(c.value(r))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(
    title,
  )}</title></head><body><table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

/** Descarga CSV UTF-8 con BOM. Nombre: `<base>-YYYY-MM-DD.csv`. */
export function exportCsv<T>(
  base: string,
  rows: T[],
  columns: ExportColumn<T>[],
): void {
  const csv = toCsv(rows, columns);
  const bom = '﻿';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `${base}-${new Date().toISOString().slice(0, 10)}.csv`);
}

/** Descarga Excel-compatible .xls (HTML tabla). */
export function exportXls<T>(
  base: string,
  rows: T[],
  columns: ExportColumn<T>[],
): void {
  const html = toXlsHtml(base, rows, columns);
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  downloadBlob(blob, `${base}-${new Date().toISOString().slice(0, 10)}.xls`);
}

/** Abre una ventana con la tabla y dispara print — el usuario guarda como PDF. */
export function exportPdf<T>(
  title: string,
  rows: T[],
  columns: ExportColumn<T>[],
  subtitle?: string,
): void {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    // Pop-up bloqueado: igual descarga el HTML para que lo imprima a mano.
    const html = buildPdfHtml(title, rows, columns, subtitle);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, `${title}-${new Date().toISOString().slice(0, 10)}.html`);
    return;
  }
  w.document.write(buildPdfHtml(title, rows, columns, subtitle));
  w.document.close();
  // Esperar a que renderice antes de imprimir.
  w.onload = () => {
    w.focus();
    w.print();
  };
}

function buildPdfHtml<T>(
  title: string,
  rows: T[],
  columns: ExportColumn<T>[],
  subtitle?: string,
): string {
  const head = columns
    .map((c) => `<th>${escHtml(c.header)}</th>`)
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => `<td>${escHtml(c.value(r))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const generatedAt = new Date().toLocaleString('es-EC');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #f3f3f3; }
  tr:nth-child(even) td { background: #fafafa; }
  @media print {
    body { margin: 10mm; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<h1>${escHtml(title)}</h1>
<div class="meta">${subtitle ? escHtml(subtitle) + ' · ' : ''}Generado ${escHtml(generatedAt)}</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body>
</html>`;
}

/** Exporta en el formato pedido con la misma signature. */
export function exportTable<T>(
  format: ExportFormat,
  title: string,
  rows: T[],
  columns: ExportColumn<T>[],
  subtitle?: string,
): void {
  if (format === 'csv') return exportCsv(title, rows, columns);
  if (format === 'xls') return exportXls(title, rows, columns);
  return exportPdf(title, rows, columns, subtitle);
}
