import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ClipboardList } from 'lucide-react';
import { query, execute } from '@/lib/db';
import { fullName } from '@/lib/format';
import { useBranchId } from '@/store/session';
import { ROUTES } from '@/config/constants';
import { Card, Button, EmptyState, Select } from '@/components/ui';
import { useStaff } from '@/features/pos/useCatalog';
import {
  type AppointmentRow,
  type RangeMode,
  rangeFor,
  isOverdue,
  ToggleBtn,
  KanbanView,
} from '@/features/calendar/appointmentBoard';
import { AppointmentActionsModal } from '@/features/calendar/AppointmentActions';
import type { AppointmentStatus } from '@/types';

/**
 * Tablero de tareas tipo Trello: las citas del rango agrupadas por estado.
 * Se opera arrastrando entre columnas o con el menú de acciones al hacer click
 * en una tarjeta. Resalta las citas vencidas (reservadas de días pasados).
 */
export function TasksPage() {
  const branchId = useBranchId();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [range, setRange] = useState<RangeMode>('today');
  const [selected, setSelected] = useState<AppointmentRow | null>(null);
  const [notice, setNotice] = useState('');

  const staff = useStaff();
  const [staffFilter, setStaffFilter] = useState('');

  const { from, to, label } = useMemo(() => rangeFor(range), [range]);

  const appts = useQuery({
    queryKey: ['appointments', branchId, from, to],
    enabled: !!branchId,
    queryFn: () =>
      query<AppointmentRow>(
        `SELECT a.id, a.start_at, a.end_at, a.status, a.notes,
                a.google_calendar_id, a.google_calendar_event_id,
                a.google_color_hex,
                c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS customer_name,
                c.phone,
                s.id AS staff_id,
                s.first_name || CASE WHEN s.last_name IS NOT NULL THEN ' ' || s.last_name ELSE '' END AS staff_name,
                s.color AS staff_color,
                sv.name AS service_name
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ['appointments'] });

  const filteredRows = useMemo(() => {
    let rows = appts.data ?? [];
    if (staffFilter) rows = rows.filter((a) => a.staff_id === staffFilter);
    return rows;
  }, [appts.data, staffFilter]);

  const overdueCount = useMemo(
    () => filteredRows.filter(isOverdue).length,
    [filteredRows],
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
    <div className="mx-auto max-w-[1500px] space-y-4">
      {/* Barra: título + rango + filtro + acción (se apila en móvil). */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-white">Tareas</h1>
          {overdueCount > 0 && (
            <span className="rounded-full bg-danger/20 px-2 py-0.5 text-xs font-medium text-danger">
              {overdueCount} vencida{overdueCount > 1 ? 's' : ''}
            </span>
          )}
          <span className="ml-auto hidden text-sm capitalize text-white/50 sm:inline">
            {label}
          </span>
          <Button
            className="ml-auto shrink-0 sm:ml-0"
            onClick={() => navigate(ROUTES.appointmentNew)}
          >
            <CalendarPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Nueva cita</span>
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-1 gap-1 rounded-xl bg-ink-800/60 p-1">
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

          <div className="sm:w-56">
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
          </div>
        </div>
      </div>

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
              (appts.data?.length ?? 0) > 0
                ? 'Ninguna cita coincide con los filtros.'
                : 'No hay citas para el rango seleccionado.'
            }
          />
        </Card>
      ) : (
        <KanbanView
          rows={filteredRows}
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
    </div>
  );
}
