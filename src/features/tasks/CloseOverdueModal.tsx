import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ClipboardCheck } from 'lucide-react';
import { batch, query } from '@/lib/db';
import { dateShort, money, timeShort } from '@/lib/format';
import { useBranchId } from '@/store/session';
import { Button, Input, Modal, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { NO_CHARGE_MARK, ymd } from '@/features/calendar/appointmentBoard';
import type { AppointmentStatus } from '@/types';
import { invalidateAppointments } from '@/lib/queryClient';

/** Cita vencida pendiente de cerrar (reservada o atendiendo de un día pasado). */
export interface OverdueRow {
  id: string;
  start_at: string;
  status: AppointmentStatus;
  customer_name: string | null;
  service_name: string | null;
  staff_name: string | null;
  /** Abono ya cobrado de la cita (pago sin venta todavía). */
  deposit: number;
}

/**
 * Todas las citas vencidas pendientes de la sucursal (sin límite de rango): el
 * tablero muestra un rango, pero el cierre masivo trabaja sobre la pila real.
 */
export function useOverduePending() {
  const branchId = useBranchId();
  // El corte lo marca la fecha LOCAL del navegador, no el reloj del servidor
  // de la base (UTC): de noche, en UTC−5, "hoy" ya sería mañana allá y las
  // citas de hoy entrarían como vencidas.
  const today = ymd(new Date());
  return useQuery({
    queryKey: ['overdue-pending', branchId, today],
    enabled: !!branchId,
    queryFn: () =>
      query<OverdueRow>(
        `SELECT a.id, a.start_at, a.status,
                c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS customer_name,
                COALESCE(sv.name, ai.category) AS service_name,
                s.first_name || CASE WHEN s.last_name IS NOT NULL THEN ' ' || s.last_name ELSE '' END AS staff_name,
                (SELECT COALESCE(SUM(p.amount), 0) FROM payment p
                  WHERE p.appointment_id = a.id AND p.sale_id IS NULL
                    AND p.status = 'confirmed') AS deposit
           FROM appointment a
           LEFT JOIN customer c ON c.id = a.customer_id
           LEFT JOIN appointment_item ai
                  ON ai.id = (SELECT ai2.id FROM appointment_item ai2
                               WHERE ai2.appointment_id = a.id LIMIT 1)
           LEFT JOIN staff_member s ON s.id = ai.assigned_staff_id
           LEFT JOIN service sv ON sv.id = ai.service_id
          WHERE a.branch_id = ? AND a.status IN ('reserved','confirmed')
            AND date(a.start_at) < ?
          ORDER BY a.start_at DESC`,
        [branchId, today],
      ),
  });
}

/** Primer día del mes en curso ("YYYY-MM-01"). */
const monthStart = (): string => `${ymd(new Date()).slice(0, 7)}-01`;

const DEFAULT_NOTE = 'Atendida sin registrar cobro (cierre retroactivo)';
/** Máximo de sentencias por lote (evita un batch enorme de una sola vez). */
const CHUNK = 40;

/**
 * Cierre masivo de citas vencidas: las marca **Atendidas sin registrar el
 * ingreso** y les deja una observación con la marca `[Sin cobro]`.
 *
 * No toca finanzas: no crea venta, ni pago, ni movimiento de caja, así que la
 * caja se puede cuadrar sin inventar ingresos. La cita queda identificada para
 * poder registrar la venta después (la ficha lo permite mientras tenga marca).
 */
export function CloseOverdueModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const rows = useOverduePending();

  const [scope, setScope] = useState<'month' | 'all'>('month');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [note, setNote] = useState(DEFAULT_NOTE);
  const [error, setError] = useState('');
  const [done, setDone] = useState(0);

  const visible = useMemo(() => {
    const all = rows.data ?? [];
    if (scope === 'all') return all;
    const from = monthStart();
    return all.filter((r) => r.start_at.slice(0, 10) >= from);
  }, [rows.data, scope]);

  const selected = visible.filter((r) => !excluded.has(r.id));
  const depositTotal = selected.reduce((n, r) => n + (r.deposit || 0), 0);
  const allOn = selected.length === visible.length && visible.length > 0;

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setExcluded(allOn ? new Set(visible.map((r) => r.id)) : new Set());

  const close = useMutation({
    mutationFn: async () => {
      const ids = selected.map((r) => r.id);
      if (ids.length === 0) throw new Error('No hay citas seleccionadas.');
      const text = `${NO_CHARGE_MARK} ${note.trim() || DEFAULT_NOTE}`;
      const now = new Date().toISOString();
      for (let i = 0; i < ids.length; i += CHUNK) {
        await batch(
          ids.slice(i, i + CHUNK).map((id) => ({
            // La observación se agrega al final de las que ya tuviera la cita.
            sql: `UPDATE appointment
                     SET status = 'attended',
                         notes = CASE
                           WHEN notes IS NULL OR trim(notes) = '' THEN ?
                           ELSE notes || char(10) || ?
                         END,
                         updated_at = ?
                   WHERE id = ? AND status IN ('reserved','confirmed')`,
            args: [text, text, now, id] as (string | number | null)[],
          })),
        );
        setDone(Math.min(i + CHUNK, ids.length));
      }
      return ids.length;
    },
    onSuccess: (n) => {
      invalidateAppointments(qc);
      setDone(n);
      onClose();
      toast.success(
        `${n} cita${n === 1 ? '' : 's'} cerrada${n === 1 ? '' : 's'} sin cobro`,
        'Quedaron atendidas, sin venta ni ingreso registrado.',
      );
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'No se pudieron cerrar.';
      setError(msg);
      toast.error('No se pudieron cerrar las citas', msg);
    },
  });

  return (
    <Modal open onClose={onClose} title="Cerrar vencidas sin cobro">
      <div className="space-y-4">
        <div className="flex gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Las citas quedan <b>Atendidas</b> con la observación{' '}
            <b>{NO_CHARGE_MARK}</b> y <b>sin registrar ingreso</b>: no se crea
            venta, ni cobro, ni movimiento de caja. Después podés registrar la
            venta de cualquiera de ellas desde su ficha.
          </p>
        </div>

        {/* Alcance de la pila */}
        <div className="flex h-9 items-center gap-0.5 rounded-lg bg-ink-800/80 p-0.5 ring-1 ring-white/10">
          {(
            [
              { key: 'month', label: 'Este mes' },
              { key: 'all', label: 'Todas las vencidas' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setScope(t.key);
                setExcluded(new Set());
              }}
              className={cn(
                'h-8 flex-1 rounded-md px-2 text-sm font-medium transition-colors',
                scope === t.key
                  ? 'bg-gold-400 text-ink-950'
                  : 'text-white/60 hover:text-white',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {rows.isLoading ? (
          <p className="py-6 text-center text-sm text-white/50">Cargando…</p>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/50">
            No hay citas vencidas pendientes en este alcance.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs font-medium text-gold-300 hover:underline"
              >
                {allOn ? 'Quitar todas' : 'Seleccionar todas'}
              </button>
              <span className="text-xs text-white/40">
                {selected.length} de {visible.length}
              </span>
            </div>

            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {visible.map((r) => {
                const on = !excluded.has(r.id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => toggle(r.id)}
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors',
                        on
                          ? 'border-gold/40 bg-gold/[0.08]'
                          : 'border-white/10 bg-white/[0.02] opacity-60',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          on
                            ? 'border-gold-400 bg-gold-400 text-ink-950'
                            : 'border-white/25',
                        )}
                      >
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span className="kpi-gold text-xs">
                            {dateShort(r.start_at.slice(0, 10))} ·{' '}
                            {timeShort(r.start_at)}
                          </span>
                          {r.deposit > 0 && (
                            <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">
                              Abono {money(r.deposit)}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-sm text-white">
                          {r.customer_name ?? 'Sin cliente'}
                        </span>
                        <span className="block truncate text-xs text-white/40">
                          {r.service_name ?? 'Servicio'}
                          {r.staff_name ? ` · ${r.staff_name}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <Input
              label="Observación que queda en cada cita"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={DEFAULT_NOTE}
            />

            {depositTotal > 0 && (
              <p className="text-xs text-white/50">
                {money(depositTotal)} en abonos ya cobrados siguen registrados
                como otros ingresos (no se tocan).
              </p>
            )}
            {error && <p className="text-xs text-danger">{error}</p>}
            {close.isPending && done > 0 && (
              <p className="text-xs text-white/50">
                {done} de {selected.length} procesadas…
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                disabled={selected.length === 0}
                loading={close.isPending}
                onClick={() => {
                  setError('');
                  close.mutate();
                }}
              >
                <ClipboardCheck className="h-4 w-4" /> Marcar {selected.length}{' '}
                atendida{selected.length === 1 ? '' : 's'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
