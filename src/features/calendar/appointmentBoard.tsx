import { useMemo, useState } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { Check, GripVertical, Play } from 'lucide-react';
import { execute, query } from '@/lib/db';
import { useBranchId } from '@/store/session';
import { APPOINTMENT_STATUS } from '@/config/constants';
import { timeShort, dateShort } from '@/lib/format';
import { ymd } from '@/lib/date';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { invalidateAppointments } from '@/lib/queryClient';
import type { AppointmentStatus } from '@/types';
import { customerNameSql } from '@/features/clients/customerNameSql';

/** Fila de cita usada por la agenda (lista/calendario) y el tablero de tareas. */
export interface AppointmentRow {
  id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  notes: string | null;
  customer_name: string | null;
  phone: string | null;
  staff_id: string | null;
  staff_name: string | null;
  staff_color: string | null;
  service_name: string | null;
  google_calendar_id: string | null;
  google_calendar_event_id: string | null;
  /** Color con que se pintó el evento en Google (hex ya resuelto en el sync). */
  google_color_hex: string | null;
}

/**
 * "Iniciar atención": pasa la cita a confirmada. Está acá y no en cada pantalla
 * porque la agenda, el calendario y el dashboard ofrecen el mismo botón y antes
 * cada copia invalidaba un juego distinto de consultas.
 */
export async function startAttention(
  qc: QueryClient,
  appointmentId: string,
): Promise<void> {
  await execute(
    "UPDATE appointment SET status = 'confirmed', updated_at = ? WHERE id = ?",
    [new Date().toISOString(), appointmentId],
  );
  invalidateAppointments(qc, appointmentId);
}

const FALLBACK_COLOR = '#64748b';

/**
 * Color con el que se pinta la cita: el de la colaboradora asignada y, si no
 * hay ninguna, el que tiene el evento en Google. El gris solo aparece cuando
 * no hay ni una cosa ni la otra.
 */
export const rowColor = (a: {
  staff_color: string | null;
  google_color_hex?: string | null;
}): string => a.staff_color || a.google_color_hex || FALLBACK_COLOR;

export const STATUS_ORDER: AppointmentStatus[] = [
  'reserved',
  'confirmed',
  'attended',
  'cancelled',
  'no_show',
];

export type RangeMode = 'today' | 'week' | 'month';

export { ymd };

/**
 * Cita "vencida": reservada o atendiendo cuyo día ya pasó. Estado derivado
 * (no se guarda). No implica que se canceló ni que se atendió.
 */
export function isOverdue(a: {
  status: AppointmentStatus;
  start_at: string;
}): boolean {
  if (a.status !== 'reserved' && a.status !== 'confirmed') return false;
  return a.start_at.slice(0, 10) < ymd(new Date());
}

/**
 * Marca que queda en `appointment.notes` cuando una cita vencida se cierra
 * como atendida SIN registrar el ingreso (cierre retroactivo para cuadrar
 * caja). El esquema no tiene columna para esto, así que la marca en las
 * observaciones es la fuente de verdad: mientras esté, la cita se puede
 * cobrar después (no está "vendida").
 */
export const NO_CHARGE_MARK = '[Sin cobro]';

/** ¿Cita cerrada como atendida pero sin venta ni cobro registrados? */
export function isNoCharge(a: {
  status: AppointmentStatus;
  notes?: string | null;
}): boolean {
  return a.status === 'attended' && (a.notes ?? '').includes(NO_CHARGE_MARK);
}

/** Quita la marca de "sin cobro" (al registrar la venta después). */
export function stripNoCharge(notes: string | null | undefined): string | null {
  const rest = (notes ?? '')
    .split('\n')
    .filter((l) => !l.trim().startsWith(NO_CHARGE_MARK))
    .join('\n')
    .trim();
  return rest || null;
}

/** Mueve el ancla del rango un paso (día, semana o mes según el modo). */
export function shiftAnchor(mode: RangeMode, anchor: string, step: number): string {
  const d = new Date(`${anchor}T00:00:00`);
  if (mode === 'today') d.setDate(d.getDate() + step);
  else if (mode === 'week') d.setDate(d.getDate() + step * 7);
  else d.setMonth(d.getMonth() + step, 1);
  return ymd(d);
}

/**
 * Rango de fechas del modo elegido. `anchor` ("YYYY-MM-DD") permite mirar otro
 * día, semana o mes; sin ancla es siempre el rango de hoy.
 */
export function rangeFor(
  mode: RangeMode,
  anchor?: string,
): { from: string; to: string; label: string } {
  const now = anchor ? new Date(`${anchor}T00:00:00`) : new Date();
  if (mode === 'today') {
    const t = ymd(now);
    return { from: t, to: t, label: dateShort(t) };
  }
  if (mode === 'week') {
    const diffToMon = (now.getDay() + 6) % 7; // 0=lunes
    const mon = new Date(now);
    mon.setDate(now.getDate() - diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
      from: ymd(mon),
      to: ymd(sun),
      label: `${dateShort(ymd(mon))} — ${dateShort(ymd(sun))}`,
    };
  }
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: ymd(first),
    to: ymd(last),
    label: now.toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }),
  };
}

/**
 * Citas de la sucursal en un rango de fechas (inclusive). La comparten la
 * agenda, la vista de calendario y el tablero de tareas: una sola consulta y
 * una sola clave de caché.
 */
export function useAppointments(from: string, to: string) {
  const branchId = useBranchId();
  return useQuery({
    queryKey: ['appointments', branchId, from, to],
    enabled: !!branchId,
    queryFn: () =>
      query<AppointmentRow>(
        `SELECT a.id, a.start_at, a.end_at, a.status, a.notes,
                a.google_calendar_id, a.google_calendar_event_id,
                a.google_color_hex,
                ${customerNameSql()} AS customer_name,
                c.phone,
                s.id AS staff_id,
                s.first_name || CASE WHEN s.last_name IS NOT NULL THEN ' ' || s.last_name ELSE '' END AS staff_name,
                s.color AS staff_color,
                COALESCE(sv.name, ai.category) AS service_name
           FROM appointment a
           LEFT JOIN customer c ON c.id = a.customer_id
           LEFT JOIN appointment_item ai
                  ON ai.id = (SELECT ai2.id FROM appointment_item ai2
                               WHERE ai2.appointment_id = a.id LIMIT 1)
           LEFT JOIN staff_member s ON s.id = ai.assigned_staff_id
           LEFT JOIN service sv ON sv.id = ai.service_id
          WHERE a.branch_id = ? AND date(a.start_at) BETWEEN ? AND ?
          ORDER BY a.start_at ASC`,
        [branchId, from, to],
      ),
  });
}

export function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex min-h-[40px] flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-gold-400 text-ink-950' : 'text-white/60 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Botón principal de la cita en la lista de agenda.
 * - Reservada → "Empezar a Atender" (solo marca atendiendo, no abre la ficha).
 * - Atendiendo (confirmed) → "Finalizar y Cobrar" (abre la ficha para cobrar).
 * - Atendida/cancelada/sin asistir → sin botón.
 */
function AttendButton({
  a,
  onStart,
  onFinish,
  full,
}: {
  a: AppointmentRow;
  /** Reservada → pasa a "atendiendo" sin salir de la pantalla. */
  onStart: (a: AppointmentRow) => void;
  /** Atendiendo → abre la ficha para confirmar el detalle y cobrar. */
  onFinish: (a: AppointmentRow) => void;
  full?: boolean;
}) {
  if (a.status !== 'reserved' && a.status !== 'confirmed') return null;
  const started = a.status === 'confirmed';
  return (
    <Button
      variant={started ? 'gold' : 'outline'}
      onClick={() => (started ? onFinish(a) : onStart(a))}
      className={cn(
        'shrink-0',
        // En móvil ocupa todo el ancho (pulgar); en escritorio vuelve a ser
        // un botón compacto dentro de la fila.
        full && 'h-12 w-full lg:h-9 lg:w-auto lg:px-3.5 lg:text-sm',
      )}
    >
      {started ? (
        <>
          <Check className="h-4 w-4" /> Finalizar y Cobrar
        </>
      ) : (
        <>
          <Play className="h-4 w-4" /> Empezar a Atender
        </>
      )}
    </Button>
  );
}


export function ListView({
  rows,
  showDate,
  onStart,
  onFinish,
  onOpen,
}: {
  rows: AppointmentRow[];
  showDate: boolean;
  onStart: (a: AppointmentRow) => void;
  onFinish: (a: AppointmentRow) => void;
  /** Tocar la tarjeta abre el menú de acciones de la cita. */
  onOpen?: (a: AppointmentRow) => void;
}) {
  return (
    <ul className="space-y-2.5 lg:space-y-0 lg:divide-y lg:divide-white/5 lg:rounded-3xl lg:border lg:border-white/10 lg:bg-white/[0.02] lg:px-5">
      {rows.map((a) => {
        const meta = APPOINTMENT_STATUS[a.status];
        const color = rowColor(a);
        const overdue = isOverdue(a);
        return (
          <li
            key={a.id}
            onClick={() => onOpen?.(a)}
            className={cn(
              'glass-card flex flex-col gap-3 p-3.5 lg:flex-row lg:items-center lg:gap-3 lg:rounded-none lg:border-0 lg:bg-none lg:p-0 lg:py-3 lg:shadow-none',
              onOpen && 'cursor-pointer',
              overdue && 'border-danger/40 lg:border-0',
            )}
          >
            <div className="flex items-start gap-3 lg:min-w-0 lg:flex-1 lg:items-center">
              <span
                className="mt-0.5 h-11 w-1.5 shrink-0 rounded-full lg:mt-0 lg:h-10"
                style={{ backgroundColor: color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="kpi-gold text-sm">
                    {showDate ? `${dateShort(a.start_at.slice(0, 10))} · ` : ''}
                    {timeShort(a.start_at)}–{timeShort(a.end_at)}
                  </p>
                  {overdue && (
                    <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-danger">
                      Vencida
                    </span>
                  )}
                  {isNoCharge(a) && (
                    <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
                      Sin cobro
                    </span>
                  )}
                  {/* El estado va junto a la hora en móvil; en escritorio, al final. */}
                  <span className="lg:hidden">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </span>
                </div>
                <p className="truncate text-base font-medium text-white lg:text-sm">
                  {a.customer_name ?? 'Sin cliente'}
                </p>
                <p className="truncate text-xs text-white/40">
                  {a.service_name ?? 'Servicio'}
                  {a.staff_name ? ` · ${a.staff_name}` : ''}
                </p>
              </div>
            </div>

            <div
              className="flex items-center gap-3 lg:contents"
              onClick={(e) => e.stopPropagation()}
            >
              <AttendButton a={a} onStart={onStart} onFinish={onFinish} full />
              <span className="hidden lg:inline">
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Estados a los que NO se puede arrastrar una tarjeta ya atendida (finanzas). */
const LOCKED_FROM: AppointmentStatus = 'attended';

export function KanbanView({
  rows,
  onSelect,
  onMove,
  columns = STATUS_ORDER,
}: {
  rows: AppointmentRow[];
  /** Click en una tarjeta: abre el menú de acciones de la cita. */
  onSelect: (a: AppointmentRow) => void;
  /** Mover una tarjeta a otra columna (estado destino). */
  onMove?: (a: AppointmentRow, toStatus: AppointmentStatus) => void;
  /** Columnas visibles (por defecto todos los estados, en orden). */
  columns?: AppointmentStatus[];
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<AppointmentStatus | null>(null);

  const byId = useMemo(() => {
    const m = new Map<string, AppointmentRow>();
    for (const a of rows) m.set(a.id, a);
    return m;
  }, [rows]);

  const byStatus = useMemo(() => {
    const m: Record<AppointmentStatus, AppointmentRow[]> = {
      reserved: [],
      confirmed: [],
      attended: [],
      cancelled: [],
      no_show: [],
    };
    for (const a of rows) m[a.status].push(a);
    return m;
  }, [rows]);

  const dragRow = dragId ? byId.get(dragId) : undefined;
  const canDrag = !!onMove;

  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:snap-none lg:px-0">
      {columns.map((status) => {
        const meta = APPOINTMENT_STATUS[status];
        const items = byStatus[status];
        // ¿Se puede soltar acá la tarjeta que se arrastra?
        const droppable =
          canDrag &&
          !!dragRow &&
          dragRow.status !== status &&
          dragRow.status !== LOCKED_FROM;
        const isOver = overStatus === status && droppable;
        return (
          <div
            key={status}
            className={cn(
              'w-[82vw] max-w-xs shrink-0 snap-center rounded-xl p-1 transition-colors sm:w-64 sm:snap-align-none',
              isOver && 'bg-gold/10 ring-1 ring-gold/40',
            )}
            onDragOver={(e) => {
              if (!droppable) return;
              e.preventDefault();
              setOverStatus(status);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setOverStatus(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOverStatus(null);
              const id = e.dataTransfer.getData('text/plain');
              const row = byId.get(id);
              if (row && onMove && row.status !== status) onMove(row, status);
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2 py-1.5">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-white/60">
                {items.length}
              </span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-white/30">
                  {isOver ? 'Soltar acá' : 'Vacío'}
                </div>
              ) : (
                items.map((a) => {
                  const color = rowColor(a);
                  const locked = a.status === LOCKED_FROM;
                  const draggable = canDrag && !locked;
                  const overdue = isOverdue(a);
                  const noCharge = isNoCharge(a);
                  return (
                    <div
                      key={a.id}
                      draggable={draggable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', a.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragId(a.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverStatus(null);
                      }}
                      onClick={() => onSelect(a)}
                      className={cn(
                        'min-h-[76px] cursor-pointer rounded-xl border bg-ink-800/60 p-3 hover:border-white/25',
                        overdue ? 'border-danger/50' : 'border-white/10',
                        draggable && 'active:cursor-grabbing',
                        dragId === a.id && 'opacity-50',
                      )}
                      style={{ borderLeft: `3px solid ${color}` }}
                    >
                      <div className="flex items-start gap-1.5">
                        {draggable && (
                          <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/25" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="kpi-gold text-xs">
                              {dateShort(a.start_at.slice(0, 10))} ·{' '}
                              {timeShort(a.start_at)}
                            </p>
                            {overdue && (
                              <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-danger">
                                Vencida
                              </span>
                            )}
                            {noCharge && (
                              <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
                                Sin cobro
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-sm font-medium text-white">
                            {a.customer_name ?? 'Sin cliente'}
                          </p>
                          <p className="truncate text-xs text-white/40">
                            {a.service_name ?? 'Servicio'}
                            {a.staff_name ? ` · ${a.staff_name}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
