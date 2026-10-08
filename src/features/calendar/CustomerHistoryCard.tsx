import { Clock3, DollarSign, History, Scissors, UserRound } from 'lucide-react';
import { query, queryOne } from '@/lib/db';
import { Card, CardHeader } from '@/components/ui';
import { dateShort, money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { FREQUENT_VISITS } from './appointmentBoard';

/**
 * Resumen histórico del cliente de una cita: cuántas veces vino, qué suele
 * hacerse, con quién se atendió la última vez y en cuánto anda su ticket
 * promedio. Lo pide la ficha de la cita y las métricas se calculan a demanda
 * con una sola llamada (3 subconsultas) para no clavar la pantalla.
 */
export interface CustomerHistory {
  visits: number;
  lastVisitAt: string | null;
  lastStaffName: string | null;
  avgSpend: number;
  totalSpend: number;
  topServices: { name: string; count: number }[];
}

/**
 * Carga el historial del cliente excluyendo la cita que se está mirando (si se
 * pasa `excludeAppointmentId`): si ésta ya está marcada como atendida no debe
 * contarse como "ya vino antes".
 */
export async function loadCustomerHistory(
  customerId: string,
  excludeAppointmentId?: string | null,
): Promise<CustomerHistory> {
  const excludeId = excludeAppointmentId ?? '';
  const [visitsRow, lastRow, salesRow, topRows] = await Promise.all([
    queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointment
         WHERE customer_id = ? AND status = 'attended' AND id <> ?`,
      [customerId, excludeId],
    ),
    queryOne<{ start_at: string; staff_name: string | null }>(
      `SELECT a.start_at,
              s.first_name || CASE WHEN s.last_name IS NOT NULL
                                     THEN ' ' || s.last_name ELSE '' END AS staff_name
         FROM appointment a
         LEFT JOIN appointment_item ai
                ON ai.id = (SELECT ai2.id FROM appointment_item ai2
                             WHERE ai2.appointment_id = a.id
                               AND ai2.assigned_staff_id IS NOT NULL
                             LIMIT 1)
         LEFT JOIN staff_member s ON s.id = ai.assigned_staff_id
        WHERE a.customer_id = ? AND a.status = 'attended' AND a.id <> ?
        ORDER BY a.start_at DESC
        LIMIT 1`,
      [customerId, excludeId],
    ),
    queryOne<{ n: number; total: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
         FROM sale
        WHERE customer_id = ?
          AND status IN ('completed','partially_refunded')`,
      [customerId],
    ),
    query<{ name: string; n: number }>(
      `SELECT COALESCE(sv.name, ai.description) AS name, COUNT(*) AS n
         FROM appointment a
         JOIN appointment_item ai ON ai.appointment_id = a.id
         LEFT JOIN service sv ON sv.id = ai.service_id
        WHERE a.customer_id = ? AND a.status = 'attended' AND a.id <> ?
          AND (ai.service_id IS NOT NULL OR ai.description IS NOT NULL)
        GROUP BY name
        ORDER BY n DESC, name ASC
        LIMIT 3`,
      [customerId, excludeId],
    ),
  ]);

  const salesCount = salesRow?.n ?? 0;
  const totalSpend = salesRow?.total ?? 0;
  const avgSpend = salesCount > 0 ? totalSpend / salesCount : 0;

  return {
    visits: visitsRow?.n ?? 0,
    lastVisitAt: lastRow?.start_at ?? null,
    lastStaffName: lastRow?.staff_name ?? null,
    avgSpend,
    totalSpend,
    topServices: (topRows ?? [])
      .filter((r) => !!r.name)
      .map((r) => ({ name: r.name, count: Number(r.n) })),
  };
}

/**
 * Tarjeta "Historial del cliente" dentro de la ficha de la cita. Para un
 * cliente nuevo se muestra el estado sin métricas; para uno con citas atendidas
 * se arma un panel con las cuatro cifras más útiles (visitas, última, promedio,
 * servicios habituales) + un rótulo "Frecuente" cuando pasó el umbral.
 */
export function CustomerHistoryCard({
  history,
  loading,
}: {
  history: CustomerHistory | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <CardHeader title="Historial del cliente" />
        <p className="text-xs text-white/40">Cargando historial…</p>
      </Card>
    );
  }
  if (!history) return null;

  const isNew = history.visits === 0;
  const isFrequent = history.visits >= FREQUENT_VISITS;

  return (
    <Card>
      <CardHeader
        title="Historial del cliente"
        action={
          isFrequent ? (
            <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-success">
              Frecuente
            </span>
          ) : isNew ? (
            <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-sky-200">
              Cliente nuevo
            </span>
          ) : null
        }
      />

      {isNew ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-white/60">
          Primera cita de este cliente en el salón. Preguntale por preferencias
          y sensibilidades; lo que anotes queda disponible la próxima vez.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Metric
              icon={<History className="h-3.5 w-3.5" />}
              label="Visitas previas"
              value={String(history.visits)}
            />
            <Metric
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label="Gasto promedio"
              value={money(history.avgSpend)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {history.lastVisitAt && (
              <Metric
                icon={<Clock3 className="h-3.5 w-3.5" />}
                label="Última visita"
                value={dateShort(history.lastVisitAt)}
                hint={history.lastStaffName ?? undefined}
                hintIcon={<UserRound className="h-3 w-3" />}
              />
            )}
            {history.topServices.length > 0 && (
              <Metric
                icon={<Scissors className="h-3.5 w-3.5" />}
                label="Servicios habituales"
                value={history.topServices[0].name}
                hint={
                  history.topServices.length > 1
                    ? `+ ${history.topServices
                        .slice(1)
                        .map((s) => s.name)
                        .join(', ')}`
                    : undefined
                }
              />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
  hintIcon,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  hintIcon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/50">
        <span className="text-gold-300">{icon}</span>
        {label}
      </p>
      <p className={cn('mt-1 truncate text-sm font-semibold text-white')}>
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-white/40">
          {hintIcon}
          <span className="truncate">{hint}</span>
        </p>
      )}
    </div>
  );
}
