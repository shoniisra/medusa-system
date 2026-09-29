import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { execute } from '@/lib/db';
import { fullName } from '@/lib/format';
import { ROUTES } from '@/config/constants';
import { Card, Button, EmptyState, Select, Modal } from '@/components/ui';
import { useStaff } from '@/features/pos/useCatalog';
import { cn } from '@/lib/cn';
import {
  type AppointmentRow,
  type RangeMode,
  rangeFor,
  ToggleBtn,
  ListView,
  useAppointments,
} from './appointmentBoard';
import { AppointmentActionsModal } from './AppointmentActions';

/** Marcador de carga de la lista: evita el falso "Sin citas" mientras consulta. */
function ListSkeleton() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[104px] animate-pulse rounded-3xl border border-white/5 bg-white/[0.03] lg:h-16"
        />
      ))}
    </div>
  );
}

const STATUS_TABS = [
  { key: 'all', label: 'Todos' },
  { key: 'reserved', label: 'Reservados' },
  { key: 'attended', label: 'Atendidos' },
] as const;

type StatusFilter = (typeof STATUS_TABS)[number]['key'];

/* ─────────────────────────────── Página ─────────────────────────────── */

/**
 * Agenda operativa: la lista de próximas citas y el botón para atenderlas.
 * La rejilla de calendario vive en su propia pantalla (`/calendario`) para no
 * comerse el alto útil del teléfono.
 */
export function CalendarPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeMode>('today');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Cita sobre la que está abierto el menú de acciones (el mismo de Tareas).
  const [selected, setSelected] = useState<AppointmentRow | null>(null);

  // Filtros de la lista: por colaborador y por estado.
  const staff = useStaff();
  const [staffFilter, setStaffFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { from, to, label } = useMemo(() => rangeFor(range), [range]);
  const appts = useAppointments(from, to);

  // "Empezar a Atender": la cita pasa a "Atendiendo" y la persona sigue en la
  // agenda (el detalle se carga después, al finalizar y cobrar).
  const startAttention = (a: AppointmentRow) => {
    execute(
      "UPDATE appointment SET status = 'confirmed', updated_at = ? WHERE id = ?",
      [new Date().toISOString(), a.id],
    )
      .then(() => {
        qc.invalidateQueries({ queryKey: ['appointments'] });
        qc.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      })
      .catch(() => {
        /* si falla, el estado sigue como estaba */
      });
  };

  // "Finalizar y Cobrar": abre la ficha en modo atención para cerrar la venta.
  const finishAttention = (a: AppointmentRow) => {
    navigate(`${ROUTES.appointment}/${a.id}?atender=1`);
  };

  // Aplica los filtros de colaborador + estado a las citas del rango.
  const filteredRows = useMemo(() => {
    let rows = appts.data ?? [];
    if (staffFilter) rows = rows.filter((a) => a.staff_id === staffFilter);
    if (statusFilter === 'attended') {
      rows = rows.filter((a) => a.status === 'attended');
    } else if (statusFilter === 'reserved') {
      rows = rows.filter(
        (a) => a.status === 'reserved' || a.status === 'confirmed',
      );
    }
    return rows;
  }, [appts.data, staffFilter, statusFilter]);

  const staffName = useMemo(() => {
    const s = (staff.data ?? []).find((x) => x.id === staffFilter);
    return s ? fullName(s.first_name, s.last_name ?? '') : '';
  }, [staff.data, staffFilter]);

  const activeFilters = (staffFilter ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0);

  const statusTabs = (
    <div className="flex gap-1 rounded-xl bg-ink-800/60 p-1">
      {STATUS_TABS.map((t) => (
        <ToggleBtn
          key={t.key}
          active={statusFilter === t.key}
          onClick={() => setStatusFilter(t.key)}
        >
          {t.label}
        </ToggleBtn>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-3 lg:space-y-5">
      {/* Título y acción: en móvil el alta de cita ya vive en el botón central
          de la barra inferior, así que no se repite acá. */}
      <div className="hidden items-center justify-between gap-3 lg:flex">
        <h1 className="text-2xl font-semibold text-white">Agenda</h1>
        <div className="flex items-center gap-2">
          <Link to={ROUTES.calendarView}>
            <Button variant="ghost">
              <CalendarRange className="h-4 w-4" /> Calendario
            </Button>
          </Link>
          <Button onClick={() => navigate(ROUTES.appointmentNew)}>
            <CalendarPlus className="h-4 w-4" /> Nueva cita
          </Button>
        </div>
      </div>

      {/* Una sola fila de control en móvil: rango + filtros + calendario. */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1 overflow-hidden rounded-xl bg-ink-800/60 p-1 lg:max-w-sm">
          <ToggleBtn active={range === 'today'} onClick={() => setRange('today')}>
            Hoy
          </ToggleBtn>
          <ToggleBtn active={range === 'week'} onClick={() => setRange('week')}>
            Semana
          </ToggleBtn>
          <ToggleBtn active={range === 'month'} onClick={() => setRange('month')}>
            Mes
          </ToggleBtn>
        </div>

        <button
          onClick={() => setFiltersOpen(true)}
          aria-label="Filtros"
          className="tap relative flex shrink-0 items-center justify-center rounded-xl bg-ink-800/60 px-3 text-white/60 active:bg-white/10 lg:hidden"
        >
          <SlidersHorizontal className="h-5 w-5" />
          {activeFilters > 0 && (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-gold-400" />
          )}
        </button>

        <Link
          to={ROUTES.calendarView}
          aria-label="Ver calendario"
          className="tap flex shrink-0 items-center justify-center rounded-xl bg-ink-800/60 px-3 text-white/60 active:bg-white/10 lg:hidden"
        >
          <CalendarRange className="h-5 w-5" />
        </Link>
      </div>

      {/* Filtros al aire en escritorio; en móvil van en la hoja. */}
      <div className="hidden items-center gap-2 lg:flex">
        <Select
          value={staffFilter}
          onChange={(e) => setStaffFilter(e.target.value)}
          className="w-64"
        >
          <option value="">Todos los colaboradores</option>
          {(staff.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {fullName(s.first_name, s.last_name ?? '')}
            </option>
          ))}
        </Select>
        <div className="w-80">{statusTabs}</div>
      </div>

      {/* Contexto en una línea: rango, cantidad y filtros activos. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-xs text-white/45">
        <span className="capitalize text-white/60">{label}</span>
        <span>·</span>
        <span>
          {appts.isLoading ? '…' : `${filteredRows.length} citas`}
        </span>
        {staffFilter && (
          <button
            onClick={() => setStaffFilter('')}
            className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-gold-200 lg:hidden"
          >
            {staffName}
            <X className="h-3 w-3" />
          </button>
        )}
        {statusFilter !== 'all' && (
          <button
            onClick={() => setStatusFilter('all')}
            className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-gold-200 lg:hidden"
          >
            {STATUS_TABS.find((t) => t.key === statusFilter)?.label}
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {appts.isLoading ? (
        <ListSkeleton />
      ) : filteredRows.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Sin citas"
            description={
              (appts.data?.length ?? 0) > 0
                ? 'Ninguna cita coincide con los filtros.'
                : 'No hay reservas para el rango seleccionado.'
            }
          />
        </Card>
      ) : (
        <ListView
          rows={filteredRows}
          showDate={range !== 'today'}
          onStart={startAttention}
          onFinish={finishAttention}
          onOpen={setSelected}
        />
      )}

      {selected && (
        <AppointmentActionsModal
          appt={selected}
          onClose={() => setSelected(null)}
        />
      )}

      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filtros"
        className="sm:max-w-sm"
      >
        <p className="mb-2 text-xs uppercase tracking-wide text-white/40">
          Colaborador
        </p>
        <Select
          value={staffFilter}
          onChange={(e) => setStaffFilter(e.target.value)}
        >
          <option value="">Todos los colaboradores</option>
          {(staff.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {fullName(s.first_name, s.last_name ?? '')}
            </option>
          ))}
        </Select>

        <p className="mb-2 mt-4 text-xs uppercase tracking-wide text-white/40">
          Estado
        </p>
        {statusTabs}

        <div className="mt-5 flex gap-2">
          <Button
            variant="ghost"
            className={cn('flex-1', activeFilters === 0 && 'opacity-50')}
            onClick={() => {
              setStaffFilter('');
              setStatusFilter('all');
            }}
          >
            Limpiar
          </Button>
          <Button className="flex-1" onClick={() => setFiltersOpen(false)}>
            Ver {filteredRows.length} citas
          </Button>
        </div>
      </Modal>
    </div>
  );
}
