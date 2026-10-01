import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  Eye,
  Play,
  Trash2,
  UserCog,
  UserX,
} from 'lucide-react';
import { batch, execute, query, queryOne } from '@/lib/db';
import { dateShort, fullName, toLocalNaive } from '@/lib/format';
import { ROUTES } from '@/config/constants';
import {
  deleteCalendarEvent,
  isGoogleCalendarEnabled,
  updateCalendarEvent,
} from '@/lib/googleCalendar';
import {
  Button,
  DateInput,
  Input,
  Modal,
  Select,
  useToast,
} from '@/components/ui';
import { useStaff } from '@/features/pos/useCatalog';
import type { AppointmentStatus } from '@/types';
import { isNoCharge, isOverdue, ymd } from './appointmentBoard';
import { invalidateAppointments } from '@/lib/queryClient';
import { invalidateFinance } from '@/lib/queryClient';

/**
 * Cita sobre la que opera el menú de acciones. Es el mínimo que todas las
 * pantallas que listan citas ya tienen a mano (agenda, tablero, calendario,
 * inicio); lo que falte para una acción concreta se relee de la base.
 */
export interface ApptActionTarget {
  id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  customer_name: string | null;
  service_name?: string | null;
  staff_name?: string | null;
  /** Observaciones: identifican una cita cerrada sin cobro (`[Sin cobro]`). */
  notes?: string | null;
}

/** Fila de la cita que necesitan las acciones que sincronizan con Google. */
interface ApptSyncRow {
  google_calendar_id: string | null;
  google_calendar_event_id: string | null;
}

interface ReassignRow {
  id: string;
  description: string;
  category: string | null;
  assigned_staff_id: string | null;
}

type Mode = 'menu' | 'reassign' | 'reschedule' | 'confirmDelete';

/** Título del aviso flotante para cada estado nuevo de la cita. */
const STATUS_TOAST: Partial<Record<AppointmentStatus, string>> = {
  reserved: 'Cita reservada',
  confirmed: 'Cita en atención',
  attended: 'Cita atendida',
  cancelled: 'Cita cancelada',
  no_show: 'Marcada como no asistió',
};

/** Cliente + fecha: el detalle de una línea que acompaña al aviso. */
const apptLabel = (a: ApptActionTarget) =>
  `${a.customer_name ?? 'Cita'} · ${dateShort(a.start_at.slice(0, 10))}`;

/**
 * Menú de acciones de una cita, único para toda la app: agenda, tablero de
 * tareas, calendario e inicio abren este mismo modal, así las opciones y su
 * comportamiento no se separan entre pantallas.
 *
 * - "Empezar a Atender" solo marca la cita como atendiendo (no abre la ficha).
 * - "Finalizar y Cobrar" abre la ficha para confirmar el detalle y cobrar.
 * - Las opciones se ajustan al estado: una cita atendida solo se puede ver.
 */
export function AppointmentActionsModal({
  appt,
  onClose,
}: {
  appt: ApptActionTarget;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const staff = useStaff();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('menu');
  const [date, setDate] = useState(appt.start_at.slice(0, 10));
  const [time, setTime] = useState(appt.start_at.slice(11, 16));
  const [error, setError] = useState('');

  const isAttended = appt.status === 'attended';
  // Atendida en un cierre masivo, sin venta ni cobro: todavía se puede cobrar.
  const noCharge = isNoCharge(appt);
  const isActive = appt.status === 'reserved' || appt.status === 'confirmed';
  const overdue = isOverdue(appt);
  // Una cancelada o sin asistir vuelve a "Reservada" al reprogramarla.
  const reactivates = appt.status === 'cancelled' || appt.status === 'no_show';

  // La nueva fecha y hora siempre van hacia adelante: reprogramar al pasado
  // dejaría una cita "vencida" de entrada.
  const newStart = date && time ? new Date(`${date}T${time}`) : null;
  // Solo para el aviso y el botón deshabilitado; la validación que manda está en
  // la mutación `reschedule`, que vuelve a comparar contra el reloj al guardar.
  // eslint-disable-next-line react-hooks/purity
  const inThePast = !!newStart && newStart.getTime() < Date.now();

  const invalidate = () => invalidateAppointments(qc, appt.id);

  const fail = (e: unknown, fallback: string) => {
    const msg = e instanceof Error ? e.message : fallback;
    setError(msg);
    toast.error(fallback, e instanceof Error ? e.message : undefined);
  };

  /** Datos de Google de la cita (solo se leen cuando una acción los necesita). */
  const syncRow = () =>
    queryOne<ApptSyncRow>(
      'SELECT google_calendar_id, google_calendar_event_id FROM appointment WHERE id = ?',
      [appt.id],
    );

  const setStatus = useMutation({
    mutationFn: (status: AppointmentStatus) =>
      execute('UPDATE appointment SET status = ?, updated_at = ? WHERE id = ?', [
        status,
        new Date().toISOString(),
        appt.id,
      ]),
    onSuccess: (_r, status) => {
      invalidate();
      onClose();
      toast.success(STATUS_TOAST[status] ?? 'Cita actualizada', apptLabel(appt));
    },
    onError: (e) => fail(e, 'No se pudo cambiar el estado.'),
  });

  /** Abre la ficha para cerrar la atención y cobrar; si estaba reservada, la marca atendiendo. */
  const finish = useMutation({
    mutationFn: async () => {
      if (appt.status === 'reserved') {
        await execute(
          "UPDATE appointment SET status = 'confirmed', updated_at = ? WHERE id = ?",
          [new Date().toISOString(), appt.id],
        );
      }
    },
    onSettled: () => {
      invalidate();
      onClose();
      navigate(`${ROUTES.appointment}/${appt.id}?atender=1`);
    },
  });

  const reschedule = useMutation({
    mutationFn: async () => {
      const start = new Date(`${date}T${time || '00:00'}`);
      if (start.getTime() < Date.now())
        throw new Error('No se puede reprogramar a una fecha u hora ya pasada.');
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
      const row = await syncRow();
      if (row?.google_calendar_event_id && isGoogleCalendarEnabled()) {
        try {
          await updateCalendarEvent(
            row.google_calendar_event_id,
            row.google_calendar_id,
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
      toast.success(
        'Cita reprogramada',
        `${dateShort(date)} · ${time} — ${apptLabel(appt)}`,
      );
    },
    onError: (e) => fail(e, 'No se pudo reprogramar.'),
  });

  const del = useMutation({
    mutationFn: async () => {
      const row = await syncRow();
      if (row?.google_calendar_event_id && isGoogleCalendarEnabled()) {
        try {
          await deleteCalendarEvent(
            row.google_calendar_event_id,
            row.google_calendar_id,
          );
        } catch {
          /* si falla, igual borramos el registro local */
        }
      }
      await batch([
        // El abono/seña de la cita es un pago (sale_id NULL). Al borrar la cita se
        // borra también, con su movimiento de caja si fue en efectivo; si no, el
        // cobro quedaría registrado como ingreso fantasma sin cita detrás.
        {
          sql: `DELETE FROM cash_movement WHERE payment_id IN
                  (SELECT id FROM payment WHERE appointment_id = ? AND sale_id IS NULL)`,
          args: [appt.id],
        },
        {
          sql: 'DELETE FROM payment WHERE appointment_id = ? AND sale_id IS NULL',
          args: [appt.id],
        },
        {
          sql: 'DELETE FROM appointment_item WHERE appointment_id = ?',
          args: [appt.id],
        },
        { sql: 'DELETE FROM appointment WHERE id = ?', args: [appt.id] },
      ]);
    },
    onSuccess: () => {
      invalidate();
      // El abono borrado ya no debe contar en caja ni en ingresos.
      invalidateFinance(qc);
      onClose();
      toast.info('Cita eliminada', apptLabel(appt));
    },
    onError: (e) => fail(e, 'No se pudo eliminar la cita.'),
  });

  const title = appt.customer_name ?? 'Cita';

  return (
    <Modal open onClose={onClose} title={title}>
      {mode === 'menu' && (
        <div className="space-y-3">
          <p className="text-xs text-white/50">
            {dateShort(appt.start_at.slice(0, 10))}
            {appt.service_name ? ` · ${appt.service_name}` : ''}
            {appt.staff_name ? ` · ${appt.staff_name}` : ''}
            {overdue && ' · vencida'}
          </p>

          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              onClose();
              navigate(`${ROUTES.appointment}/${appt.id}`);
            }}
          >
            <Eye className="h-4 w-4" /> Ver
          </Button>

          {/* Reasignar solo tiene sentido en una cita viva: una cancelada o sin
              asistir no tiene a quién asignarle el trabajo. */}
          {isActive && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setMode('reassign')}
            >
              <UserCog className="h-4 w-4" /> Reasignar
            </Button>
          )}

          {!isAttended && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setMode('reschedule')}
            >
              <CalendarClock className="h-4 w-4" /> Reprogramar
            </Button>
          )}

          {isActive && (
            <>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setStatus.mutate('no_show')}
              >
                <UserX className="h-4 w-4" /> No asistió
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setStatus.mutate('cancelled')}
              >
                <Ban className="h-4 w-4" /> Cancelar cita
              </Button>
            </>
          )}

          {appt.status === 'reserved' && (
            <Button
              variant="outline"
              className="w-full"
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate('confirmed')}
            >
              <Play className="h-4 w-4" /> Empezar a Atender
            </Button>
          )}

          {isActive && (
            <Button
              className="w-full"
              loading={finish.isPending}
              onClick={() => finish.mutate()}
            >
              <Check className="h-4 w-4" /> Finalizar y Cobrar
              {overdue ? ' (retroactivo)' : ''}
            </Button>
          )}

          {/* Cerrada sin cobro: la venta se puede registrar después. */}
          {noCharge && (
            <Button
              className="w-full"
              onClick={() => {
                onClose();
                navigate(`${ROUTES.appointment}/${appt.id}?atender=1`);
              }}
            >
              <Check className="h-4 w-4" /> Registrar venta y cobro
            </Button>
          )}

          {!isAttended && (
            <div className="border-t border-white/10 pt-3">
              <Button
                variant="danger"
                className="w-full"
                onClick={() => setMode('confirmDelete')}
              >
                <Trash2 className="h-4 w-4" /> Eliminar cita
              </Button>
            </div>
          )}

          {isAttended && !noCharge && (
            <p className="text-xs text-white/40">
              Cita atendida: ya tiene venta y cobro registrados. Para corregirla,
              anulá la venta desde la ficha.
            </p>
          )}
          {noCharge && (
            <p className="text-xs text-amber-200/70">
              Atendida sin cobro registrado (cierre retroactivo): no tiene venta
              ni ingreso. Si querés cobrarla, registrá la venta.
            </p>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}

      {mode === 'reassign' && (
        <ReassignPanel
          apptId={appt.id}
          staff={staff.data ?? []}
          onBack={() => setMode('menu')}
          onDone={() => {
            invalidate();
            onClose();
          }}
        />
      )}

      {mode === 'reschedule' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <DateInput
              label="Fecha"
              min={ymd(new Date())}
              value={date}
              onChange={(v) => v && setDate(v)}
              clearable={false}
            />
            <Input
              label="Hora"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          {reactivates && (
            <p className="text-xs text-white/50">
              Esta cita está{' '}
              {appt.status === 'cancelled' ? 'cancelada' : 'marcada sin asistir'}
              : al reprogramarla vuelve a quedar <b>Reservada</b>.
            </p>
          )}
          {inThePast && (
            <p className="flex items-center gap-1.5 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5" /> Esa fecha y hora ya
              pasaron: elegí un horario futuro.
            </p>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
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
              disabled={!date || !time || inThePast}
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
            {appt.customer_name ? ` de ${appt.customer_name}` : ''}? Esta acción
            no se puede deshacer.
          </p>
          {error && <p className="text-xs text-danger">{error}</p>}
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
              loading={del.isPending}
              onClick={() => del.mutate()}
            >
              Eliminar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Reasignar colaborador: una línea por servicio/categoría reservada, porque una
 * cita puede repartirse entre varias personas. Al guardar se actualiza también
 * la descripción y el color del evento en Google.
 */
function ReassignPanel({
  apptId,
  staff,
  onBack,
  onDone,
}: {
  apptId: string;
  staff: { id: string; first_name: string; last_name: string | null; color: string | null }[];
  onBack: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const rows = useQuery({
    queryKey: ['appointment-reassign', apptId],
    queryFn: () =>
      query<ReassignRow>(
        `SELECT ai.id, ai.description, ai.category, ai.assigned_staff_id
           FROM appointment_item ai
          WHERE ai.appointment_id = ? AND ai.product_id IS NULL
          ORDER BY ai.id`,
        [apptId],
      ),
  });

  const nameOf = (sid: string | null) => {
    const s = staff.find((x) => x.id === sid);
    return s ? fullName(s.first_name, s.last_name) : 'Sin asignar';
  };

  const save = useMutation({
    mutationFn: async () => {
      const items = rows.data ?? [];
      const changed = items.filter(
        (i) =>
          draft[i.id] !== undefined &&
          (draft[i.id] || null) !== i.assigned_staff_id,
      );
      if (changed.length === 0) return;
      await batch(
        changed.map((i) => ({
          sql: 'UPDATE appointment_item SET assigned_staff_id = ? WHERE id = ?',
          args: [draft[i.id] || null, i.id] as (string | null)[],
        })),
      );

      const head = await queryOne<ApptSyncRow>(
        'SELECT google_calendar_id, google_calendar_event_id FROM appointment WHERE id = ?',
        [apptId],
      );
      if (head?.google_calendar_event_id && isGoogleCalendarEnabled()) {
        const updated = items.map((i) => ({
          ...i,
          assigned_staff_id:
            draft[i.id] !== undefined ? draft[i.id] || null : i.assigned_staff_id,
        }));
        const desc = updated
          .map((i) => `• ${i.description} (${nameOf(i.assigned_staff_id)})`)
          .join('\n');
        const firstStaffId =
          updated.find((i) => i.assigned_staff_id)?.assigned_staff_id ?? null;
        const colorHex = staff.find((s) => s.id === firstStaffId)?.color ?? null;
        try {
          await updateCalendarEvent(
            head.google_calendar_event_id,
            head.google_calendar_id,
            { description: desc, colorHex },
          );
        } catch {
          /* si Google falla, la reasignación local ya quedó guardada */
        }
      }
    },
    onSuccess: () => {
      toast.success('Colaborador reasignado');
      onDone();
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'No se pudo reasignar.';
      setError(msg);
      toast.error('No se pudo reasignar', msg);
    },
  });

  const items = rows.data ?? [];

  return (
    <div className="space-y-4">
      {rows.isLoading ? (
        <p className="text-sm text-white/50">Cargando servicios…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-white/50">
          Esta cita no tiene servicios para reasignar.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((i) => (
            <Select
              key={i.id}
              label={i.description || i.category || 'Servicio'}
              value={
                draft[i.id] !== undefined
                  ? draft[i.id]
                  : i.assigned_staff_id ?? ''
              }
              onChange={(e) =>
                setDraft((d) => ({ ...d, [i.id]: e.target.value }))
              }
            >
              <option value="">Sin asignar</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {fullName(s.first_name, s.last_name)}
                </option>
              ))}
            </Select>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onBack}>
          Volver
        </Button>
        <Button
          className="flex-1"
          disabled={items.length === 0}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Guardar
        </Button>
      </div>
    </div>
  );
}
