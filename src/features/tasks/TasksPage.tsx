import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  ClipboardList,
  Check,
  UserX,
  CalendarClock,
  Ban,
  Pencil,
  Trash2,
} from 'lucide-react';
import { query, batch, execute } from '@/lib/db';
import { fullName, dateShort, toLocalNaive } from '@/lib/format';
import { useBranchId } from '@/store/session';
import { ROUTES } from '@/config/constants';
import {
  isGoogleCalendarEnabled,
  deleteCalendarEvent,
  updateCalendarEvent,
} from '@/lib/googleCalendar';
import { Card, Button, Modal, Input, EmptyState, Select } from '@/components/ui';
import { useStaff } from '@/features/pos/useCatalog';
import {
  type AppointmentRow,
  type RangeMode,
  rangeFor,
  isOverdue,
  ToggleBtn,
  KanbanView,
} from '@/features/calendar/appointmentBoard';
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

  const startAttention = (a: AppointmentRow) =>
    navigate(`${ROUTES.appointment}/${a.id}?atender=1`);

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
      startAttention(a);
      return;
    }
    setStatus.mutate({ id: a.id, status: toStatus });
  };

  const del = useMutation({
    mutationFn: async (a: AppointmentRow) => {
      if (a.google_calendar_event_id && isGoogleCalendarEnabled()) {
        try {
          await deleteCalendarEvent(a.google_calendar_event_id, a.google_calendar_id);
        } catch {
          /* si falla, igual borramos el registro local */
        }
      }
      await batch([
        { sql: 'DELETE FROM appointment_item WHERE appointment_id = ?', args: [a.id] },
        { sql: 'DELETE FROM appointment WHERE id = ?', args: [a.id] },
      ]);
    },
    onSuccess: () => {
      setSelected(null);
      invalidate();
    },
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      {/* Barra única: título + rango + filtro + acción. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-1 flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-white">Tareas</h1>
          {overdueCount > 0 && (
            <span className="rounded-full bg-danger/20 px-2 py-0.5 text-xs font-medium text-danger">
              {overdueCount} vencida{overdueCount > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="flex gap-1 rounded-xl bg-ink-800/60 p-1">
          <ToggleBtn active={range === 'today'} onClick={() => setRange('today')}>
            Hoy
          </ToggleBtn>
          <ToggleBtn active={range === 'week'} onClick={() => setRange('week')}>
            Esta semana
          </ToggleBtn>
          <ToggleBtn active={range === 'month'} onClick={() => setRange('month')}>
            Este mes
          </ToggleBtn>
        </div>

        <div className="min-w-[180px] flex-1 sm:max-w-xs">
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

        <span className="hidden text-sm capitalize text-white/50 sm:inline">
          {label}
        </span>

        <Button className="ml-auto" onClick={() => navigate(ROUTES.appointmentNew)}>
          <CalendarPlus className="h-4 w-4" /> Nueva cita
        </Button>
      </div>

      {notice && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-center text-xs text-amber-200">
          {notice}
        </p>
      )}

      {filteredRows.length === 0 ? (
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
        <TaskActionsModal
          appt={selected}
          onClose={() => setSelected(null)}
          onAtender={() => startAttention(selected)}
          onStatus={(status) => {
            setStatus.mutate({ id: selected.id, status });
            setSelected(null);
          }}
          onEdit={() => navigate(`${ROUTES.appointment}/${selected.id}`)}
          onDelete={() => del.mutate(selected)}
          invalidate={invalidate}
          deleting={del.isPending}
        />
      )}
    </div>
  );
}

/**
 * Menú de acciones de una cita: Atender (retroactivo si aplica), No asistió,
 * Reprogramar, Cancelar, más Editar ficha y Eliminar. Las opciones se ajustan
 * al estado (una cita atendida no se cancela ni se borra).
 */
function TaskActionsModal({
  appt,
  onClose,
  onAtender,
  onStatus,
  onEdit,
  onDelete,
  invalidate,
  deleting,
}: {
  appt: AppointmentRow;
  onClose: () => void;
  onAtender: () => void;
  onStatus: (status: AppointmentStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  invalidate: () => void;
  deleting: boolean;
}) {
  const [mode, setMode] = useState<'menu' | 'reschedule' | 'confirmDelete'>('menu');
  const [date, setDate] = useState(appt.start_at.slice(0, 10));
  const [time, setTime] = useState(appt.start_at.slice(11, 16));

  const isAttended = appt.status === 'attended';
  const isActive = appt.status === 'reserved' || appt.status === 'confirmed';
  const overdue = isOverdue(appt);
  const attendLabel =
    appt.status === 'confirmed' ? 'Finalizar y cobrar' : 'Atender';

  const reschedule = useMutation({
    mutationFn: async () => {
      const start = new Date(`${date}T${time || '00:00'}`);
      const durMs =
        new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime();
      const end = new Date(start.getTime() + (durMs > 0 ? durMs : 60 * 60000));
      const startLocal = toLocalNaive(start);
      const endLocal = toLocalNaive(end);
      // Reprogramar una cancelada/sin asistir la reactiva a reservada.
      await execute(
        `UPDATE appointment
            SET start_at = ?, end_at = ?,
                status = CASE WHEN status IN ('cancelled','no_show') THEN 'reserved' ELSE status END,
                updated_at = ?
          WHERE id = ?`,
        [startLocal, endLocal, new Date().toISOString(), appt.id],
      );
      if (appt.google_calendar_event_id && isGoogleCalendarEnabled()) {
        try {
          await updateCalendarEvent(
            appt.google_calendar_event_id,
            appt.google_calendar_id,
            { startLocal, endLocal },
          );
        } catch {
          /* la reprogramación local ya quedó guardada */
        }
      }
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const title = appt.customer_name ?? 'Cita';

  return (
    <Modal open onClose={onClose} title={title}>
      {mode === 'menu' && (
        <div className="space-y-3">
          <p className="text-xs text-white/50">
            {dateShort(appt.start_at.slice(0, 10))} · {appt.service_name ?? 'Servicio'}
            {appt.staff_name ? ` · ${appt.staff_name}` : ''}
            {overdue && ' · vencida'}
          </p>

          {isActive && (
            <>
              <Button className="w-full justify-start" onClick={onAtender}>
                <Check className="h-4 w-4" /> {attendLabel}
                {overdue ? ' (retroactivo)' : ''}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => onStatus('no_show')}
              >
                <UserX className="h-4 w-4" /> No asistió
              </Button>
            </>
          )}

          {!isAttended && (
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setMode('reschedule')}
            >
              <CalendarClock className="h-4 w-4" /> Reprogramar
            </Button>
          )}

          {isActive && (
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => onStatus('cancelled')}
            >
              <Ban className="h-4 w-4" /> Cancelar cita
            </Button>
          )}

          <div className="flex gap-2 border-t border-white/10 pt-3">
            <Button variant="outline" className="flex-1" onClick={onEdit}>
              <Pencil className="h-4 w-4" /> {isAttended ? 'Ver ficha' : 'Editar'}
            </Button>
            {!isAttended && (
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => setMode('confirmDelete')}
              >
                <Trash2 className="h-4 w-4" /> Eliminar
              </Button>
            )}
          </div>

          {isAttended && (
            <p className="text-xs text-white/40">
              Cita atendida: ya tiene venta y cobro registrados.
            </p>
          )}
        </div>
      )}

      {mode === 'reschedule' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Fecha"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Input
              label="Hora"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setMode('menu')}
            >
              Volver
            </Button>
            <Button
              className="flex-1"
              disabled={!date || !time}
              loading={reschedule.isPending}
              onClick={() => reschedule.mutate()}
            >
              Guardar
            </Button>
          </div>
        </div>
      )}

      {mode === 'confirmDelete' && (
        <div className="space-y-4">
          <p className="text-sm text-white/70">
            ¿Seguro que querés eliminar esta cita
            {appt.customer_name ? ` de ${appt.customer_name}` : ''}? Esta acción no
            se puede deshacer.
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setMode('menu')}
            >
              Volver
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={deleting}
              onClick={onDelete}
            >
              Eliminar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
