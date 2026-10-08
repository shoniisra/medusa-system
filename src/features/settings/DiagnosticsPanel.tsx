import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { query } from '@/lib/db';
import { Button, Card, CardHeader, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';

interface AppErrorRow {
  id: string;
  occurred_at: string;
  source: string;
  status: number;
  message: string;
  context: string | null;
}

/**
 * Lista los últimos 50 errores del Worker (`app_error_log`): sirve para forensia
 * cuando algo se cae en producción sin tener que mirar `wrangler tail`.
 */
export function DiagnosticsPanel() {
  const errors = useQuery({
    queryKey: ['app-error-log'],
    queryFn: () =>
      query<AppErrorRow>(
        `SELECT id, occurred_at, source, status, message, context
           FROM app_error_log
          ORDER BY occurred_at DESC
          LIMIT 50`,
      ),
  });

  const rows = errors.data ?? [];

  return (
    <Card>
      <CardHeader
        title="Errores recientes"
        subtitle="Últimos 50 errores registrados por el Worker (api/db, api/gcal)"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void errors.refetch();
            }}
            loading={errors.isFetching}
          >
            <RefreshCcw className="h-4 w-4" /> Actualizar
          </Button>
        }
      />

      {errors.isLoading ? (
        <p className="text-sm text-white/50">Cargando…</p>
      ) : errors.isError ? (
        <p className="text-sm text-danger">
          No se pudo leer el log: {errors.error.message}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Sin errores registrados"
          description="Todavía no hay entradas en app_error_log."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="px-2 py-2 font-medium">Cuándo</th>
                <th className="px-2 py-2 font-medium">Origen</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Mensaje</th>
                <th className="px-2 py-2 font-medium">Contexto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-2 py-2 text-xs text-white/60 whitespace-nowrap">
                    {formatOccurredAt(r.occurred_at)}
                  </td>
                  <td className="px-2 py-2 text-xs text-white/70 whitespace-nowrap">
                    {r.source}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-2 text-xs font-semibold',
                      r.status >= 500 ? 'text-danger' : 'text-amber-300',
                    )}
                  >
                    {r.status}
                  </td>
                  <td className="px-2 py-2 text-xs text-white max-w-[32ch] break-words">
                    {r.message}
                  </td>
                  <td className="px-2 py-2 text-xs text-white/50 max-w-[36ch] break-words">
                    {r.context ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function formatOccurredAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
