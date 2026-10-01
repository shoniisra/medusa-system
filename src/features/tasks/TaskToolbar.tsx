import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react';
import { APPOINTMENT_STATUS } from '@/config/constants';
import { fullName } from '@/lib/format';
import { cn } from '@/lib/cn';
import { DateInput } from '@/components/ui';
import { useAnchoredPanel } from '@/components/ui/useAnchoredPanel';
import {
  STATUS_ORDER,
  shiftAnchor,
  ymd,
  type RangeMode,
} from '@/features/calendar/appointmentBoard';
import type { AppointmentStatus, StaffMember } from '@/types';

/** Filtros del tablero de tareas (todos viven en la barra superior). */
export interface TaskFilters {
  /** Texto libre: cliente, servicio, colaborador, teléfono u observación. */
  q: string;
  /** Rango de fechas: día, semana o mes. */
  mode: RangeMode;
  /** Día ancla del rango ("YYYY-MM-DD"): permite mirar otro mes o semana. */
  anchor: string;
  staffId: string;
  /** Estados visibles; vacío = todas las columnas. */
  statuses: AppointmentStatus[];
  onlyOverdue: boolean;
}

export const defaultTaskFilters = (): TaskFilters => ({
  q: '',
  mode: 'today',
  anchor: ymd(new Date()),
  staffId: '',
  statuses: [],
  onlyOverdue: false,
});

/** ¿Hay algún filtro puesto (sin contar el rango de fechas)? */
export const activeFilterCount = (f: TaskFilters): number =>
  (f.q.trim() ? 1 : 0) +
  (f.staffId ? 1 : 0) +
  (f.statuses.length ? 1 : 0) +
  (f.onlyOverdue ? 1 : 0);

const MODES: { key: RangeMode; label: string }[] = [
  { key: 'today', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
];

/* ───────────────────────── Piezas de la barra ───────────────────────── */

const PILL =
  'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-sm font-medium transition-colors';
const PILL_OFF =
  'border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.09] hover:text-white';
const PILL_ON = 'border-gold/60 bg-gold/15 text-gold-100 shadow-gold-glow';

/** Contador de filtros aplicados dentro de una pastilla. */
function CountBadge({ n }: { n: number }) {
  return (
    <span className="rounded bg-gold-400 px-1 text-[10px] font-bold text-ink-950">
      {n}
    </span>
  );
}

/**
 * Menú desplegable de un filtro. Se dibuja en un portal (posición fija) para
 * que no lo recorte la fila de filtros cuando se desliza en móvil.
 */
function FilterMenu({
  label,
  icon,
  on,
  count,
  width = 252,
  children,
}: {
  label: string;
  icon: ReactNode;
  on?: boolean;
  count?: number;
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const rect = useAnchoredPanel(open, close, btn, panel);

  const w = Math.min(width, window.innerWidth - 16);
  const left = rect
    ? Math.max(8, Math.min(rect.left, window.innerWidth - 8 - w))
    : 0;

  return (
    <>
      <button
        type="button"
        ref={btn}
        onClick={() => setOpen((v) => !v)}
        className={cn(PILL, on ? PILL_ON : PILL_OFF)}
      >
        {icon}
        <span className="max-w-[9rem] truncate">{label}</span>
        {!!count && <CountBadge n={count} />}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={panel}
            data-floating
            style={{
              position: 'fixed',
              top: rect.bottom + 6,
              left,
              width: w,
              maxHeight: Math.max(200, window.innerHeight - rect.bottom - 24),
              zIndex: 60,
            }}
            className="overflow-y-auto rounded-xl border border-white/10 bg-ink-800 p-1.5 shadow-glass"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Fila de opción dentro de un menú de filtro. */
function MenuRow({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[38px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-white/10',
        active ? 'text-gold-200' : 'text-white/80',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active && <Check className="h-4 w-4 shrink-0" />}
    </button>
  );
}

/* ─────────────────────────────── Barra ─────────────────────────────── */

/**
 * Barra de filtros del tablero, compacta y en una sola fila (estilo Trello):
 * buscador, rango con navegación de fechas, colaborador, estado, solo vencidas
 * y limpiar. En móvil se apila el buscador y el resto se desliza en horizontal.
 */
export function TaskToolbar({
  filters,
  onChange,
  rangeLabel,
  staff,
  overdueInView,
  resultCount,
}: {
  filters: TaskFilters;
  onChange: (patch: Partial<TaskFilters>) => void;
  /** Etiqueta del rango visible (ya calculada por la página). */
  rangeLabel: string;
  staff: StaffMember[];
  /** Vencidas dentro del rango, para el contador de la pastilla. */
  overdueInView: number;
  resultCount: number;
}) {
  const f = filters;
  const today = ymd(new Date());
  const active = activeFilterCount(f);

  const staffName = (() => {
    const s = staff.find((x) => x.id === f.staffId);
    return s ? fullName(s.first_name, s.last_name ?? '') : 'Colaborador';
  })();

  const statusLabel =
    f.statuses.length === 0
      ? 'Estado'
      : f.statuses.length === 1
        ? APPOINTMENT_STATUS[f.statuses[0]].label
        : 'Estado';

  const toggleStatus = (st: AppointmentStatus) =>
    onChange({
      statuses: f.statuses.includes(st)
        ? f.statuses.filter((x) => x !== st)
        : [...f.statuses, st],
    });

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2 backdrop-blur-xl">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {/* Buscador */}
        <div className="relative w-full lg:max-w-[16rem]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            type="search"
            value={f.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Buscar cliente, servicio…"
            className="h-9 w-full rounded-lg border border-white/10 bg-ink-800/80 pl-8 pr-8 text-sm text-white placeholder:text-white/30 focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
          />
          {f.q && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => onChange({ q: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-white/40 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Resto de controles: se desliza en móvil, en línea en escritorio. */}
        <div className="edge-row items-center lg:flex-1 lg:flex-wrap">
          {/* Rango: día / semana / mes */}
          <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg bg-ink-800/80 p-0.5 ring-1 ring-white/10">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => onChange({ mode: m.key })}
                className={cn(
                  'h-8 rounded-md px-2.5 text-sm font-medium transition-colors',
                  f.mode === m.key
                    ? 'bg-gold-400 text-ink-950 shadow-gold-glow'
                    : 'text-white/60 hover:text-white',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Navegación de fechas + salto a otro mes/día */}
          <div className="flex h-9 shrink-0 items-center rounded-lg bg-ink-800/80 ring-1 ring-white/10">
            <button
              type="button"
              aria-label="Anterior"
              onClick={() =>
                onChange({ anchor: shiftAnchor(f.mode, f.anchor, -1) })
              }
              className="flex h-9 w-8 items-center justify-center rounded-l-lg text-white/60 hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <FilterMenu
              label={rangeLabel}
              icon={<CalendarDays className="h-3.5 w-3.5 opacity-70" />}
              on={f.anchor !== today}
              width={260}
            >
              {(close) => (
                <div className="space-y-2 p-1">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-white/60">
                      Ir al mes
                    </span>
                    <input
                      type="month"
                      value={f.anchor.slice(0, 7)}
                      onChange={(e) =>
                        e.target.value &&
                        onChange({
                          anchor: `${e.target.value}-01`,
                          mode: f.mode === 'today' ? 'month' : f.mode,
                        })
                      }
                      className="h-9 w-full rounded-lg border border-white/10 bg-ink-900 px-2 text-sm text-white focus:border-gold/50 focus:outline-none"
                    />
                  </label>
                  <DateInput
                    label="Ir a una fecha"
                    value={f.anchor}
                    onChange={(v) => v && onChange({ anchor: v })}
                    clearable={false}
                    size="sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ anchor: today });
                      close();
                    }}
                    className="h-9 w-full rounded-lg border border-white/10 text-sm text-white/80 hover:bg-white/10"
                  >
                    Volver a hoy
                  </button>
                </div>
              )}
            </FilterMenu>
            <button
              type="button"
              aria-label="Siguiente"
              onClick={() =>
                onChange({ anchor: shiftAnchor(f.mode, f.anchor, 1) })
              }
              className="flex h-9 w-8 items-center justify-center rounded-r-lg text-white/60 hover:bg-white/10 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Colaborador */}
          <FilterMenu
            label={staffName}
            icon={<UserRound className="h-3.5 w-3.5 opacity-70" />}
            on={!!f.staffId}
          >
            {(close) => (
              <>
                <MenuRow
                  active={!f.staffId}
                  onClick={() => {
                    onChange({ staffId: '' });
                    close();
                  }}
                >
                  Todos los colaboradores
                </MenuRow>
                {staff.map((s) => (
                  <MenuRow
                    key={s.id}
                    active={f.staffId === s.id}
                    onClick={() => {
                      onChange({ staffId: s.id });
                      close();
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: s.color || '#64748b' }}
                      />
                      <span className="truncate">
                        {fullName(s.first_name, s.last_name ?? '')}
                      </span>
                    </span>
                  </MenuRow>
                ))}
              </>
            )}
          </FilterMenu>

          {/* Estado (multiselección: también decide qué columnas se ven) */}
          <FilterMenu
            label={statusLabel}
            icon={<SlidersHorizontal className="h-3.5 w-3.5 opacity-70" />}
            on={f.statuses.length > 0}
            count={f.statuses.length > 1 ? f.statuses.length : 0}
          >
            {() => (
              <>
                <MenuRow
                  active={f.statuses.length === 0}
                  onClick={() => onChange({ statuses: [] })}
                >
                  Todos los estados
                </MenuRow>
                {STATUS_ORDER.map((st) => (
                  <MenuRow
                    key={st}
                    active={f.statuses.includes(st)}
                    onClick={() => toggleStatus(st)}
                  >
                    {APPOINTMENT_STATUS[st].label}
                  </MenuRow>
                ))}
              </>
            )}
          </FilterMenu>

          {/* Solo vencidas */}
          <button
            type="button"
            onClick={() => onChange({ onlyOverdue: !f.onlyOverdue })}
            className={cn(PILL, f.onlyOverdue ? PILL_ON : PILL_OFF)}
          >
            <TriangleAlert className="h-3.5 w-3.5 opacity-80" />
            Vencidas
            {overdueInView > 0 && <CountBadge n={overdueInView} />}
          </button>

          {active > 0 && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  q: '',
                  staffId: '',
                  statuses: [],
                  onlyOverdue: false,
                })
              }
              className={cn(PILL, PILL_OFF, 'text-white/50')}
            >
              <X className="h-3.5 w-3.5" /> Limpiar
            </button>
          )}

          <span className="ml-auto hidden shrink-0 pr-1 text-xs text-white/40 lg:inline">
            {resultCount} {resultCount === 1 ? 'tarea' : 'tareas'}
          </span>
        </div>
      </div>
    </div>
  );
}
