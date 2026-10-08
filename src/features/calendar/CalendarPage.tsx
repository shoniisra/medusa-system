import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, CalendarRange } from 'lucide-react';
import { ROUTES } from '@/config/constants';
import { Button, Badge } from '@/components/ui';
import { useStaff } from '@/features/pos/useCatalog';
import {
  type AppointmentRow,
  ListView,
  startAttention,
} from './appointmentBoard';
import { AppointmentActionsModal } from './AppointmentActions';
import { FilterBar } from './FilterBar';
import { useAppointmentListFilters } from './useAppointmentListFilters';
import { AppointmentsEmptyState } from './AppointmentsEmptyState';

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

  // Cita sobre la que está abierto el menú de acciones (el mismo de Tareas).
  const [selected, setSelected] = useState<AppointmentRow | null>(null);

  const staff = useStaff();
  const { filters, patch, label, appts, filteredRows, overdueInView } =
    useAppointmentListFilters();

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
        <AppointmentsEmptyState
          icon={CalendarDays}
          title="Sin citas"
          totalRows={appts.data?.length ?? 0}
          filters={filters}
          filteredHint="Ninguna cita coincide con los filtros."
          emptyHint="No hay reservas para el rango seleccionado."
        />
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
