import { useMemo, useState } from 'react';
import { Check, GripVertical } from 'lucide-react';
import { APPOINTMENT_STATUS } from '@/config/constants';
import { timeShort, dateShort } from '@/lib/format';
import { Card, Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { AppointmentStatus } from '@/types';

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
}

export const FALLBACK_COLOR = '#64748b';

export const STATUS_ORDER: AppointmentStatus[] = [
  'reserved',
  'confirmed',
  'attended',
  'cancelled',
  'no_show',
];

export type RangeMode = 'today' | 'week' | 'month';

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Cita "vencida": reservada o atendiendo cuyo día ya pasó. Estado derivado
 * (no se guarda). No implica que se canceló ni que se atendió.
 */
export function isOverdue(a: AppointmentRow): boolean {
  if (a.status !== 'reserved' && a.status !== 'confirmed') return false;
  return a.start_at.slice(0, 10) < ymd(new Date());
}

export function rangeFor(mode: RangeMode): { from: string; to: string; label: string } {
  const now = new Date();
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
        'flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active ? 'bg-gold-400 text-ink-950' : 'text-white/60 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Botón principal de la cita en la lista de agenda.
 * - Reservada → "Atender" (marca atendiendo y abre la ficha).
 * - Atendiendo (confirmed) → "Finalizar y Cobrar" (abre la ficha para cobrar).
 * - Atendida/cancelada/sin asistir → sin botón.
 */
export function AttendButton({
  a,
  onAttend,
  full,
}: {
  a: AppointmentRow;
  onAttend: (a: AppointmentRow) => void;
  full?: boolean;
}) {
  if (a.status !== 'reserved' && a.status !== 'confirmed') return null;
  const label = a.status === 'confirmed' ? 'Finalizar y Cobrar' : 'Atender';
  return (
    <Button
      size="sm"
      onClick={() => onAttend(a)}
      className={full ? 'mt-2 w-full' : 'shrink-0'}
    >
      <Check className="h-4 w-4" /> {label}
    </Button>
  );
}


export function ListView({
  rows,
  showDate,
  onAttend,
}: {
  rows: AppointmentRow[];
  showDate: boolean;
  onAttend: (a: AppointmentRow) => void;
}) {
  return (
    <Card>
      <ul className="divide-y divide-white/5">
        {rows.map((a) => {
          const meta = APPOINTMENT_STATUS[a.status];
          const color = a.staff_color || FALLBACK_COLOR;
          return (
            <li key={a.id} className="flex items-center gap-3 py-3">
              <span
                className="h-10 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="kpi-gold text-sm">
                    {showDate ? `${dateShort(a.start_at.slice(0, 10))} · ` : ''}
                    {timeShort(a.start_at)}–{timeShort(a.end_at)}
                  </p>
                </div>
                <p className="truncate text-sm font-medium text-white">
                  {a.customer_name ?? 'Sin cliente'}
                </p>
                <p className="truncate text-xs text-white/40">
                  {a.service_name ?? 'Servicio'}
                  {a.staff_name ? ` · ${a.staff_name}` : ''}
                </p>
              </div>
              <AttendButton a={a} onAttend={onAttend} />
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Estados a los que NO se puede arrastrar una tarjeta ya atendida (finanzas). */
const LOCKED_FROM: AppointmentStatus = 'attended';

export function KanbanView({
  rows,
  onSelect,
  onMove,
}: {
  rows: AppointmentRow[];
  /** Click en una tarjeta: abre el menú de acciones de la cita. */
  onSelect: (a: AppointmentRow) => void;
  /** Mover una tarjeta a otra columna (estado destino). */
  onMove?: (a: AppointmentRow, toStatus: AppointmentStatus) => void;
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
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STATUS_ORDER.map((status) => {
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
              'w-64 shrink-0 rounded-xl p-1 transition-colors',
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
            <div className="mb-2 flex items-center justify-between px-1">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <span className="text-xs text-white/40">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-white/30">
                  {isOver ? 'Soltar acá' : 'Vacío'}
                </div>
              ) : (
                items.map((a) => {
                  const color = a.staff_color || FALLBACK_COLOR;
                  const locked = a.status === LOCKED_FROM;
                  const draggable = canDrag && !locked;
                  const overdue = isOverdue(a);
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
                        'cursor-pointer rounded-xl border bg-ink-800/60 p-3 hover:border-white/25',
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
