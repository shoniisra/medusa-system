import { useEffect, useRef, useState } from 'react';
import { Download, FileText, FileSpreadsheet, Printer } from 'lucide-react';
import { cn } from '@/lib/cn';
import { exportTable, type ExportColumn, type ExportFormat } from './exportTx';

/**
 * Botón "Exportar" con menú desplegable (CSV / Excel / PDF). Se usa en las
 * pestañas de Transacciones, Resumen y Deudas.
 */
export function ExportMenu<T>({
  title,
  rows,
  columns,
  subtitle,
  disabled,
}: {
  title: string;
  rows: T[];
  columns: ExportColumn<T>[];
  subtitle?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (format: ExportFormat) => {
    setOpen(false);
    exportTable(format, title, rows, columns, subtitle);
  };

  const empty = rows.length === 0 || disabled;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={empty}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-medium text-white/90 transition-colors hover:bg-white/10',
          'disabled:cursor-not-allowed disabled:opacity-40',
        )}
      >
        <Download className="h-4 w-4" /> Exportar
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-xl border border-white/10 bg-ink-900 shadow-xl">
          <MenuItem
            icon={<FileText className="h-4 w-4" />}
            label="CSV"
            hint="Para hoja de cálculo"
            onClick={() => pick('csv')}
          />
          <MenuItem
            icon={<FileSpreadsheet className="h-4 w-4" />}
            label="Excel (.xls)"
            onClick={() => pick('xls')}
          />
          <MenuItem
            icon={<Printer className="h-4 w-4" />}
            label="PDF"
            hint="Imprimir / guardar"
            onClick={() => pick('pdf')}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/5"
    >
      {icon}
      <div className="flex-1">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-white/40">{hint}</p>}
      </div>
    </button>
  );
}
