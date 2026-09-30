import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ClipboardCheck, ClipboardList } from 'lucide-react';
import { execute } from '@/lib/db';
import { ROUTES } from '@/config/constants';
import { Card, Button, EmptyState } from '@/components/ui';
import { useStaff } from '@/features/pos/useCatalog';
import {
  type AppointmentRow,
  rangeFor,
  isOverdue,
  useAppointments,
  KanbanView,
  STATUS_ORDER,
} from '@/features/calendar/appointmentBoard';
import { AppointmentActionsModal } from '@/features/calendar/AppointmentActions';
import {
  TaskToolbar,
  defaultTaskFilters,
  activeFilterCount,
  type TaskFilters,
} from './TaskToolbar';
import { CloseOverdueModal, useOverduePending } from './CloseOverdueModal';
import type { AppointmentStatus } from '@/types';

/**
 * Tablero de tareas tipo Trello: las citas del rango agrupadas por estado.
 * Se opera arrastrando entre columnas o con el menú de acciones al hacer click
 * en una tarjeta. Resalta las citas vencidas (reservadas de días pasados).
 */
export function TasksPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [filters, setFilters] = useState<TaskFilters>(defaultTaskFilters);
  const patch = (p: Partial<TaskFilters>) =>
    setFilters((f) => ({ ...f, ...p }));

  const [selected, setSelected] = useState<AppointmentRow | null>(null);
  const [closeOverdue, setCloseOverdue] = useState(false);
  const [notice, setNotice] = useState('');

  const staff = useStaff();

  const { from, to, label } = useMemo(
    () => rangeFor(filters.mode, filters.anchor),
    [filters.mode, filters.anchor],
  );

  const appts = useAppointments(from, to);
  // Pila total de vencidas (independiente del rango): habilita el cierre masivo.
  const overduePending = useOverduePending();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['overdue-pending'] });
    qc.invalidateQueries({ queryKey: ['overdue-count'] });
  };

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
  const overdueTotal = overduePending.data?.length ?? 0;

  // Columnas visibles: filtrar por estado es mostrar solo esas listas.
  const columns = useMemo(
    () =>
      filters.statuses.length
        ? STATUS_ORDER.filter((s) => filters.statuses.includes(s))
        : STATUS_ORDER,
    [filters.statuses],
  );

  // Arrastrar a "Atendido" no marca la cita: abre la ficha para confirmar el
  // detalle y cobrar (igual que "Finalizar y Cobrar" del menú de acciones).
  const finishAttention = (a: AppointmentRow) => {
    if (a.status === 'reserved') {
      execute(
        "UPDATE appointment SET status = 'confirmed', updated_at = ? WHERE id = ?",
        [new Date().toISOString(), a.id],
      )
        .then(invalidate)
        .catch(() => {
          /* si falla, igual seguimos a la ficha */
        });
    }
    navigate(`${ROUTES.appointment}/${a.id}?atender=1`);
  };

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AppointmentStatus }) =>
      execute('UPDATE appointment SET status = ?, updated_at = ? WHERE id = ?', [
        status,
        new Date().toISOString(),
        id,
      ]),
    onSuccess: invalidate,
  });

  /**
   * Arrastrar una tarjeta a otra columna:
   * - A "Atendido" nunca se marca directo: abre la ficha para confirmar
   *   servicios, valor y registrar el cobro (Confirmar Venta).
   * - Una cita ya atendida no se puede mover (evita desajustar finanzas).
   * - El resto de estados se cambian en el acto.
   */
  const handleMove = (a: AppointmentRow, toStatus: AppointmentStatus) => {
    setNotice('');
    if (a.status === toStatus) return;
    if (a.status === 'attended') {
      setNotice(
        'Una cita atendida ya tiene venta y cobro: no se puede mover de columna.',
      );
      return;
    }
    if (toStatus === 'attended') {
      finishAttention(a);
      return;
    }
    setStatus.mutate({ id: a.id, status: toStatus });
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-3">
      {/* Encabezado compacto: título + pila de vencidas + acciones. */}
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-white sm:text-2xl">Tareas</h1>
        {overdueTotal > 0 && (
          <span className="rounded-full bg-danger/20 px-2 py-0.5 text-xs font-medium text-danger">
            {overdueTotal} vencida{overdueTotal > 1 ? 's' : ''}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {overdueTotal > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCloseOverdue(true)}
            >
              <ClipboardCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Cerrar vencidas</span>
            </Button>
          )}
          <Button size="sm" onClick={() => navigate(ROUTES.appointmentNew)}>
            <CalendarPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Nueva cita</span>
          </Button>
        </div>
      </div>

      <TaskToolbar
        filters={filters}
        onChange={patch}
        rangeLabel={label}
        staff={staff.data ?? []}
        overdueInView={overdueInView}
        resultCount={filteredRows.length}
      />

      {notice && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-center text-xs text-amber-200">
          {notice}
        </p>
      )}

      {appts.isLoading ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-40 w-[82vw] max-w-xs shrink-0 animate-pulse rounded-xl border border-white/5 bg-white/[0.03] sm:w-64"
            />
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="Sin tareas"
            description={
              (appts.data?.length ?? 0) > 0 || activeFilterCount(filters) > 0
                ? 'Ninguna cita coincide con los filtros.'
                : 'No hay citas para el rango seleccionado.'
            }
          />
        </Card>
      ) : (
        <KanbanView
          rows={filteredRows}
          columns={columns}
          onSelect={setSelected}
          onMove={handleMove}
        />
      )}

      {selected && (
        <AppointmentActionsModal
          appt={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {closeOverdue && (
        <CloseOverdueModal onClose={() => setCloseOverdue(false)} />
      )}
    </div>
  );
}
