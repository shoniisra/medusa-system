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
import { Button, DateInput, Modal, Select } from '@/components/ui';
import { useAnchoredPanel } from '@/components/ui/useAnchoredPanel';
import { STATUS_ORDER, ToggleBtn, shiftAnchor, ymd, type RangeMode } from './appointmentBoard';
import type { AppointmentStatus, StaffMember } from '@/types';

/**
 * Filtros de citas, compartidos entre Agenda y Tareas: ambas pantallas listan
 * las mismas citas (una como lista, otra como tablero) y deben filtrarse igual.
 */
export interface AppointmentFilters {
  /** Texto libre: cliente, servicio, colaborador, teléfono u observación. */
  q: string;
  /** Rango de fechas: día, semana o mes. */
  mode: RangeMode;
  /** Día ancla del rango ("YYYY-MM-DD"): permite mirar otro mes o semana. */
  anchor: string;
  staffId: string;
  /** Estados visibles; vacío = todos. */
  statuses: AppointmentStatus[];
  onlyOverdue: boolean;
}

export const defaultAppointmentFilters = (): AppointmentFilters => ({
  q: '',
  mode: 'today',
  anchor: ymd(new Date()),
  staffId: '',
  statuses: [],
  onlyOverdue: false,
});

/** ¿Hay algún filtro puesto (sin contar el rango de fechas)? */
export const activeFilterCount = (f: AppointmentFilters): number =>
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
  'inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-sm font-medium transition-colors';
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
 * que no lo recorte la fila de filtros.
 */
function FilterMenu({
  label,
  icon,
  on,
  count,
  width = 260,
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
        <span className="max-w-[10rem] truncate">{label}</span>
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

/** Contenido del salto de fecha (mes / día puntual / volver a hoy). */
function JumpToDate({
  anchor,
  mode,
  onChange,
  onDone,
}: {
  anchor: string;
  mode: RangeMode;
  onChange: (patch: Partial<AppointmentFilters>) => void;
  onDone?: () => void;
}) {
  const today = ymd(new Date());
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-white/60">
          Ir al mes
        </span>
        <input
          type="month"
          value={anchor.slice(0, 7)}
          onChange={(e) =>
            e.target.value &&
            onChange({
              anchor: `${e.target.value}-01`,
              mode: mode === 'today' ? 'month' : mode,
            })
          }
          className="h-9 w-full rounded-lg border border-white/10 bg-ink-900 px-2 text-sm text-white focus:border-gold/50 focus:outline-none"
        />
      </label>
      <DateInput
        label="Ir a una fecha"
        value={anchor}
        onChange={(v) => v && onChange({ anchor: v })}
        clearable={false}
        size="sm"
      />
      <button
        type="button"
        onClick={() => {
          onChange({ anchor: today });
          onDone?.();
        }}
        className="h-9 w-full rounded-lg border border-white/10 text-sm text-white/80 hover:bg-white/10"
      >
        Volver a hoy
      </button>
    </div>
  );
}

/* ─────────────────────────────── Barra ─────────────────────────────── */

/**
 * Barra de filtros de citas, compartida por Agenda y Tareas: buscador, rango
 * con navegación de fechas, colaborador, estado (multiselección) y vencidas.
 * En escritorio es una sola fila al aire; en móvil se reduce al selector de
 * rango y un botón de "Filtros" que abre los demás en una hoja.
 */
export function FilterBar({
  filters,
  onChange,
  rangeLabel,
  staff,
  overdueInView,
  resultCount,
  resultNoun = 'citas',
  mobileExtra,
}: {
  filters: AppointmentFilters;
  onChange: (patch: Partial<AppointmentFilters>) => void;
  /** Etiqueta del rango visible (ya calculada por la página). */
  rangeLabel: string;
  staff: StaffMember[];
  /** Vencidas dentro del rango, para el contador de la pastilla. */
  overdueInView: number;
  resultCount: number;
  resultNoun?: string;
  /** Acción extra junto al botón de filtros en móvil (ej. ver calendario). */
  mobileExtra?: ReactNode;
}) {
  const f = filters;
  const today = ymd(new Date());
  const active = activeFilterCount(f);
  const [sheetOpen, setSheetOpen] = useState(false);

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

  const clearAll = () =>
    onChange({ q: '', staffId: '', statuses: [], onlyOverdue: false });

  return (
    <>
      {/* ─────────── Escritorio: una sola fila, sin recortes ─────────── */}
      <div className="hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-xl lg:flex lg:items-center lg:gap-3">
        {/* Buscador */}
        <div className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            type="search"
            value={f.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Buscar cliente, servicio…"
            className="h-10 w-full rounded-lg border border-white/10 bg-ink-800/80 pl-9 pr-8 text-sm text-white placeholder:text-white/30 focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
          />
          {f.q && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => onChange({ q: '' })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-white/40 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-3">
          {/* Rango: día / semana / mes */}
          <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-lg bg-ink-800/80 p-0.5 ring-1 ring-white/10">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => onChange({ mode: m.key })}
                className={cn(
                  'h-9 rounded-md px-3 text-sm font-medium transition-colors',
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
          <div className="flex h-10 shrink-0 items-center rounded-lg bg-ink-800/80 ring-1 ring-white/10">
            <button
              type="button"
              aria-label="Anterior"
              onClick={() =>
                onChange({ anchor: shiftAnchor(f.mode, f.anchor, -1) })
              }
              className="flex h-10 w-9 items-center justify-center rounded-l-lg text-white/60 hover:bg-white/10 hover:text-white"
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
                <div className="p-1">
                  <JumpToDate
                    anchor={f.anchor}
                    mode={f.mode}
                    onChange={onChange}
                    onDone={close}
                  />
                </div>
              )}
            </FilterMenu>
            <button
              type="button"
              aria-label="Siguiente"
              onClick={() =>
                onChange({ anchor: shiftAnchor(f.mode, f.anchor, 1) })
              }
              className="flex h-10 w-9 items-center justify-center rounded-r-lg text-white/60 hover:bg-white/10 hover:text-white"
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

          {/* Estado (multiselección) */}
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
              onClick={clearAll}
              className={cn(PILL, PILL_OFF, 'text-white/50')}
            >
              <X className="h-3.5 w-3.5" /> Limpiar
            </button>
          )}

          <span className="ml-auto shrink-0 rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/50">
            {resultCount} {resultNoun}
          </span>
        </div>
      </div>

      {/* ─────────── Móvil: rango + botón de filtros ─────────── */}
      <div className="flex items-center gap-2 lg:hidden">
        <div className="flex flex-1 gap-1 overflow-hidden rounded-xl bg-ink-800/60 p-1">
          {MODES.map((m) => (
            <ToggleBtn
              key={m.key}
              active={f.mode === m.key}
              onClick={() => onChange({ mode: m.key })}
            >
              {m.label}
            </ToggleBtn>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Filtros"
          className="tap relative flex shrink-0 items-center justify-center rounded-xl bg-ink-800/60 px-3 text-white/60 active:bg-white/10"
        >
          <SlidersHorizontal className="h-5 w-5" />
          {active > 0 && (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-gold-400" />
          )}
        </button>

        {mobileExtra}
      </div>

      {/* Contexto en una línea: rango, cantidad y filtros activos. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-xs text-white/45 lg:hidden">
        <span className="capitalize text-white/60">{rangeLabel}</span>
        <span>·</span>
        <span>
          {resultCount} {resultNoun}
        </span>
        {f.q && (
          <button
            onClick={() => onChange({ q: '' })}
            className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-gold-200"
          >
            “{f.q}”
            <X className="h-3 w-3" />
          </button>
        )}
        {f.staffId && (
          <button
            onClick={() => onChange({ staffId: '' })}
            className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-gold-200"
          >
            {staffName}
            <X className="h-3 w-3" />
          </button>
        )}
        {f.statuses.length > 0 && (
          <button
            onClick={() => onChange({ statuses: [] })}
            className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-gold-200"
          >
            {statusLabel}
            <X className="h-3 w-3" />
          </button>
        )}
        {f.onlyOverdue && (
          <button
            onClick={() => onChange({ onlyOverdue: false })}
            className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-gold-200"
          >
            Vencidas
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Hoja de filtros (móvil) */}
      <Modal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filtros"
        className="sm:max-w-sm"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              type="search"
              value={f.q}
              onChange={(e) => onChange({ q: e.target.value })}
              placeholder="Buscar cliente, servicio…"
              className="h-10 w-full rounded-lg border border-white/10 bg-ink-900 pl-9 pr-8 text-sm text-white placeholder:text-white/30 focus:border-gold/50 focus:outline-none"
            />
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-white/40">
              Rango
            </p>
            <JumpToDate
              anchor={f.anchor}
              mode={f.mode}
              onChange={onChange}
            />
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-white/40">
              Colaborador
            </p>
            <Select
              value={f.staffId}
              onChange={(e) => onChange({ staffId: e.target.value })}
            >
              <option value="">Todos los colaboradores</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {fullName(s.first_name, s.last_name ?? '')}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-white/40">
              Estado
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onChange({ statuses: [] })}
                className={cn(
                  PILL,
                  'h-9 px-3',
                  f.statuses.length === 0 ? PILL_ON : PILL_OFF,
                )}
              >
                Todos
              </button>
              {STATUS_ORDER.map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => toggleStatus(st)}
                  className={cn(
                    PILL,
                    'h-9 px-3',
                    f.statuses.includes(st) ? PILL_ON : PILL_OFF,
                  )}
                >
                  {APPOINTMENT_STATUS[st].label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onChange({ onlyOverdue: !f.onlyOverdue })}
            className={cn(
              'flex h-10 w-full items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors',
              f.onlyOverdue ? PILL_ON : PILL_OFF,
            )}
          >
            <TriangleAlert className="h-3.5 w-3.5 opacity-80" />
            Solo vencidas
            {overdueInView > 0 && <CountBadge n={overdueInView} />}
          </button>

          <div className="flex gap-2 pt-1">
            <Button
              variant="ghost"
              className={cn('flex-1', active === 0 && 'opacity-50')}
              onClick={clearAll}
            >
              Limpiar
            </Button>
            <Button className="flex-1" onClick={() => setSheetOpen(false)}>
              Ver {resultCount} {resultNoun}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
