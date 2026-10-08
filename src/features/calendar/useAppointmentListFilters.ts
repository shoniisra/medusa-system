import { useMemo, useState } from 'react';
import { isOverdue, rangeFor, useAppointments, type AppointmentRow } from './appointmentBoard';
import {
  defaultAppointmentFilters,
  type AppointmentFilters,
} from './FilterBar';

/**
 * Estado compartido por la lista (CalendarPage) y el tablero (TasksPage):
 * filtros, rango visible, consulta de citas y filas post-filtro.
 */
export function useAppointmentListFilters() {
  const [filters, setFilters] = useState<AppointmentFilters>(
    defaultAppointmentFilters,
  );
  const patch = (p: Partial<AppointmentFilters>) =>
    setFilters((f) => ({ ...f, ...p }));

  const { from, to, label } = useMemo(
    () => rangeFor(filters.mode, filters.anchor),
    [filters.mode, filters.anchor],
  );
  const appts = useAppointments(from, to);

  const filteredRows = useMemo<AppointmentRow[]>(() => {
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

  const overdueInView = useMemo(
    () => (appts.data ?? []).filter(isOverdue).length,
    [appts.data],
  );

  return { filters, patch, from, to, label, appts, filteredRows, overdueInView };
}
