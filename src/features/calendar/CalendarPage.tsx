import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, CalendarRange } from 'lucide-react';
import { ROUTES } from '@/config/constants';
import { Card, Button, Badge, EmptyState } from '@/components/ui';
import { useStaff } from '@/features/pos/useCatalog';
import {
  type AppointmentRow,
  rangeFor,
  isOverdue,
  ListView,
  useAppointments,
  startAttention,
} from './appointmentBoard';
import { AppointmentActionsModal } from './AppointmentActions';
import {
  FilterBar,
  defaultAppointmentFilters,
  activeFilterCount,
  type AppointmentFilters,
} from './FilterBar';

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

/* ─────────────────────────────── Página ─────────────────────────────── */

/**
 * Agenda operativa: la lista de próximas citas y el botón para atenderlas.
 * La rejilla de calendario vive en su propia pantalla (`/calendario`) para no
 * comerse el alto útil del teléfono. Los filtros son los mismos que en
 * Tareas (`FilterBar`): ambas listan las mismas citas.
 */
export function CalendarPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [filters, setFilters] = useState<AppointmentFilters>(
    defaultAppointmentFilters,
  );
  const patch = (p: Partial<AppointmentFilters>) =>
    setFilters((f) => ({ ...f, ...p }));

  // Cita sobre la que está abierto el menú de acciones (el mismo de Tareas).
  const [selected, setSelected] = useState<AppointmentRow | null>(null);

  const staff = useStaff();

  const { from, to, label } = useMemo(
    () => rangeFor(filters.mode, filters.anchor),
    [filters.mode, filters.anchor],
  );
  const appts = useAppointments(from, to);

  // "Empezar a Atender": la cita pasa a "Atendiendo" y la persona sigue en la
  // agenda (el detalle se carga después, al finalizar y cobrar).
  const beginAttention = (a: { id: string }) => {
    void startAttention(qc, a.id).catch(() => {
      /* si falla, el estado sigue como estaba */
    });
  };

  // "Finalizar y Cobrar": abre la ficha en modo atención para cerrar la venta.
  const finishAttention = (a: AppointmentRow) => {
    navigate(`${ROUTES.appointment}/${a.id}?atender=1`);
  };

  // Aplica los mismos filtros que Tareas: colaborador, estado, vencidas y texto.
  const filteredRows = useMemo(() => {
    let rows = appts.data ?? [];
    const f = filters;
    if (f.staffId) rows = rows.filter((a) => a.staff_id === f.staffId);
    if (f.statuses.length)
      rows = rows.filter((a) => f.statuses.includes(a.status));
    if (f.onlyOverdue) rows = rows.filter(isOverdue);
    const q = f.q.trim().toLowerCase();
    if (q) {
      rows = rows.filter((a) =>
        [a.customer_name, a.service_name, a.staff_name, a.phone, a.notes].some(
          (v) => (v ?? '').toLowerCase().includes(q),
        ),
      );
    }
    return rows;
  }, [appts.data, filters]);

  // Vencidas del rango visible (contador de la pastilla del filtro).
  const overdueInView = useMemo(
    () => (appts.data ?? []).filter(isOverdue).length,
    [appts.data],
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-3 lg:space-y-5">
      {/* Título y acción: en móvil el alta de cita ya vive en el botón central
          de la barra inferior, así que no se repite acá. */}
      <div className="hidden items-center justify-between gap-3 lg:flex">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold text-white">Agenda</h1>
          <Badge tone="gold">Lista</Badge>
        </div>
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

      <FilterBar
        filters={filters}
        onChange={patch}
        rangeLabel={label}
        staff={staff.data ?? []}
        overdueInView={overdueInView}
        resultCount={filteredRows.length}
        resultNoun="citas"
        mobileExtra={
          <Link
            to={ROUTES.calendarView}
            aria-label="Ver calendario"
            className="tap flex shrink-0 items-center justify-center rounded-xl bg-ink-800/60 px-3 text-white/60 active:bg-white/10"
          >
            <CalendarRange className="h-5 w-5" />
          </Link>
        }
      />

      {appts.isLoading ? (
        <ListSkeleton />
      ) : filteredRows.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Sin citas"
            description={
              (appts.data?.length ?? 0) > 0 || activeFilterCount(filters) > 0
                ? 'Ninguna cita coincide con los filtros.'
                : 'No hay reservas para el rango seleccionado.'
            }
          />
        </Card>
      ) : (
        <ListView
          rows={filteredRows}
          showDate={filters.mode !== 'today'}
          onStart={beginAttention}
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
    </div>
  );
}
