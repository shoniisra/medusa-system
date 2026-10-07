import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Check,
  PlugZap,
} from 'lucide-react';
import { execute } from '@/lib/db';
import { dateShort, timeShort, toLocalNaive } from '@/lib/format';
import { useSession } from '@/store/session';
import { ROUTES } from '@/config/constants';
import {
  checkGoogleCalendar,
  isGoogleCalendarEnabled,
  updateCalendarEvent,
  listCalendarEvents,
  normalizeEvents,
} from '@/lib/googleCalendar';
import { Badge, Modal, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { GoogleCalendarEmbed } from './GoogleCalendarEmbed';
import { AgendaCalendar, type AgendaEvent, type AgendaView } from './AgendaCalendar';
import {
  type AppointmentRow,
  rowColor,
  ymd,
  useAppointments,
} from './appointmentBoard';
import { AppointmentActionsModal } from './AppointmentActions';
import { invalidateAppointments } from '@/lib/queryClient';

const VIEW_LABEL: Record<string, string> = {
  three: '3 días',
  week: 'Semana',
  month: 'Mes',
};

/** Ventana consultada: el mes visible ± una semana cubre cualquier vista. */
function windowFor(d: Date): { from: string; to: string } {
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  from.setDate(from.getDate() - 7);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  to.setDate(to.getDate() + 7);
  return { from: ymd(from), to: ymd(to) };
}

/**
 * Calendario a pantalla completa (estilo app de Google Calendar): la rejilla
 * ocupa todo el alto entre el encabezado de la app y la barra de navegación.
 * En móvil abre en 3 días; en escritorio, en semana.
 */
export function CalendarViewPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const branch = useSession((s) => s.branch);

  const [date, setDate] = useState(new Date());
  const [view, setView] = useState<AgendaView>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1024 ? 'three' : 'week',
  );
  const [source, setSource] = useState<'medusa' | 'google'>('medusa');
  const [menuOpen, setMenuOpen] = useState(false);
  // Cita sobre la que está abierto el menú de acciones (el mismo de la agenda).
  const [selected, setSelected] = useState<AppointmentRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [checking, setChecking] = useState(false);
  const toast = useToast();

  const { from, to } = useMemo(() => windowFor(date), [date]);
  const appts = useAppointments(from, to);

  const events: AgendaEvent[] = useMemo(
    () =>
      (appts.data ?? []).map((a) => ({
        id: a.id,
        title: a.customer_name ?? 'Sin cliente',
        subtitle: a.service_name ?? undefined,
        start: new Date(a.start_at),
        end: new Date(a.end_at),
        color: rowColor(a),
      })),
    [appts.data],
  );

  // Confirmación para alta en hueco vacío. Un tap suelto no debe mandar al
  // alta: se abre una pregunta corta "¿Agendar aquí a las HH:MM?".
  const [pendingSlot, setPendingSlot] = useState<Date | null>(null);

  // Arrastrar/redimensionar reprograma la cita (y su evento en Google).
  // `prev` viaja con la mutación para que el toast pueda ofrecer "Deshacer"
  // sin volver a consultar la base.
  const reschedule = useMutation({
    mutationFn: async ({
      id,
      start,
      end,
    }: {
      id: string;
      start: Date;
      end: Date;
      prev?: { start: Date; end: Date } | null;
      silent?: boolean;
    }) => {
      const row = appts.data?.find((a) => a.id === id);
      const startLocal = toLocalNaive(start);
      const endLocal = toLocalNaive(end);
      await execute(
        'UPDATE appointment SET start_at = ?, end_at = ?, updated_at = ? WHERE id = ?',
        [startLocal, endLocal, new Date().toISOString(), id],
      );
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
    onSuccess: (_r, { id, start, prev, silent }) => {
      invalidateAppointments(qc, id);
      if (silent) return;
      toast.show({
        title: 'Cita reprogramada',
        description: `${dateShort(ymd(start))} · ${timeShort(toLocalNaive(start))}`,
        tone: 'success',
        duration: 6000,
        action: prev
          ? {
              label: 'Deshacer',
              onClick: () =>
                reschedule.mutate({
                  id,
                  start: prev.start,
                  end: prev.end,
                  silent: true,
                }),
            }
          : undefined,
      });
    },
    onError: (e: Error) => toast.error('No se pudo reprogramar', e.message),
  });

  /**
   * Diagnóstico de la conexión con Google. La sincronización corre en el
   * servidor con una service account, así que cuando algo no llega a Google el
   * salón no ve ningún error: esto lo hace visible (falta compartir el
   * calendario, falta el ID en la sucursal, faltan los secrets).
   */
  async function checkGoogle() {
    setExportMsg('');
    setChecking(true);
    try {
      const r = await checkGoogleCalendar(branch?.google_calendar_id);
      if (r.ok) {
        setExportMsg(
          r.calendarId
            ? `Conectado al calendario de la sucursal como ${r.serviceAccount}.`
            : `Service account activa (${r.serviceAccount}), pero la sucursal no tiene calendario asignado.`,
        );
      } else {
        setExportMsg(r.error ?? 'No se pudo conectar con Google Calendar.');
      }
    } catch (e) {
      setExportMsg(
        e instanceof Error ? e.message : 'No se pudo conectar con Google Calendar.',
      );
    } finally {
      setChecking(false);
    }
  }

  // Exporta los eventos de Google a un JSON descargable (herramienta de
  // migración: el mapeo color→estilista se hace fuera de la app).
  async function exportGoogleJson() {
    setExportMsg('');
    setExporting(true);
    try {
      const now = new Date();
      const timeMin = new Date(now);
      timeMin.setDate(timeMin.getDate() - 120);
      const timeMax = new Date(now);
      timeMax.setDate(timeMax.getDate() + 180);
      const raw = await listCalendarEvents({
        calendarId: branch?.google_calendar_id,
        timeMinIso: timeMin.toISOString(),
        timeMaxIso: timeMax.toISOString(),
      });
      const payload = {
        exported_at: new Date().toISOString(),
        organization_id: branch?.organization_id ?? null,
        branch_id: branch?.id ?? null,
        branch_name: branch?.name ?? null,
        calendar_id: branch?.google_calendar_id ?? 'primary',
        range: { from: timeMin.toISOString(), to: timeMax.toISOString() },
        count: raw.length,
        events: normalizeEvents(raw),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gcal-eventos-${branch?.code ?? 'sucursal'}-${ymd(now)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportMsg(`Exportados ${payload.count} eventos.`);
    } catch (e) {
      setExportMsg(
        e instanceof Error ? e.message : 'No se pudo exportar de Google.',
      );
    } finally {
      setExporting(false);
    }
  }

  const step = (dir: 1 | -1) => {
    const d = new Date(date);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    else if (view === 'week') d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + 3 * dir);
    setDate(d);
  };

  // Como en la app de Google: el mes manda; el año solo aparece si no es el
  // corriente (así el título nunca se trunca en un teléfono).
  const title =
    date.toLocaleDateString('es-EC', { month: 'long' }) +
    (date.getFullYear() === new Date().getFullYear()
      ? ''
      : ` ${date.getFullYear()}`);

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ paddingBottom: 'var(--nav-h)' }}
    >
      {/* Título: misma posición que Lista/Tablero. El padding va afuera (como
          el `p-6` del `main` en esas pantallas) y el centrado adentro, para
          que quede exactamente en el mismo punto y no "salte" al navegar. */}
      <div className="hidden shrink-0 pl-6 pr-6 pt-6 lg:block">
        <div className="mx-auto flex max-w-[1500px] items-center gap-2.5">
          <span className="text-2xl font-semibold text-white">Agenda</span>
          <Badge tone="gold">Calendario</Badge>
        </div>
      </div>

      {/* Encabezado compacto: mes + navegación. Todo lo secundario va al menú. */}
      <div className="flex shrink-0 items-center gap-1 px-3 py-2 lg:px-4">
        <button
          onClick={() => setMenuOpen(true)}
          className="flex min-w-0 items-center gap-1 rounded-xl px-2 py-1.5 text-left text-lg font-semibold text-white active:bg-white/10 lg:text-xl"
        >
          <span className="truncate first-letter:uppercase">{title}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-white/50" />
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => step(-1)}
            aria-label="Anterior"
            className="tap flex items-center justify-center rounded-xl text-white/60 active:bg-white/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => step(1)}
            aria-label="Siguiente"
            className="tap flex items-center justify-center rounded-xl text-white/60 active:bg-white/10"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            onClick={() => setDate(new Date())}
            className="rounded-xl border border-white/10 px-3 py-1.5 text-sm font-medium text-white/70 active:bg-white/10"
          >
            Hoy
          </button>
        </div>
      </div>

      {source === 'google' ? (
        <div className="min-h-0 flex-1 px-3 pb-3 lg:px-4 lg:pb-4">
          <GoogleCalendarEmbed
            className="h-full"
            mode={view === 'month' ? 'MONTH' : 'WEEK'}
          />
        </div>
      ) : (
        <AgendaCalendar
          flush
          toolbar={false}
          events={events}
          date={date}
          view={view}
          onNavigate={setDate}
          onView={setView}
          onSelectEvent={(id) => {
            const row = appts.data?.find((a) => a.id === id);
            if (row) setSelected(row);
            else navigate(`${ROUTES.appointment}/${id}`);
          }}
          onDrop={(id, start, end) => {
            const row = appts.data?.find((a) => a.id === id);
            if (!row) return;
            // Mover al pasado nunca es intencional: sería "venta retroactiva"
            // sin su cobro. Si quieren mover una cita vieja, se hace desde
            // la ficha.
            if (end.getTime() < Date.now()) {
              toast.error(
                'No se puede mover al pasado',
                'Las citas pasadas se atienden desde su ficha.',
              );
              return;
            }
            const staffId = row.staff_id;
            const conflict = staffId
              ? (appts.data ?? []).find(
                  (a) =>
                    a.id !== id &&
                    a.staff_id === staffId &&
                    new Date(a.start_at) < end &&
                    start < new Date(a.end_at),
                )
              : undefined;
            if (
              conflict &&
              !window.confirm(
                `Se solapa con otra cita de ${
                  row.staff_name ?? 'la estilista'
                } (${
                  conflict.customer_name ?? 'sin cliente'
                }). ¿Reprogramar de todas formas?`,
              )
            ) {
              return;
            }
            reschedule.mutate({
              id,
              start,
              end,
              prev: { start: new Date(row.start_at), end: new Date(row.end_at) },
            });
          }}
          onSelectSlot={(start) => setPendingSlot(start)}
        />
      )}

      {selected && (
        <AppointmentActionsModal
          appt={selected}
          onClose={() => setSelected(null)}
        />
      )}

      <Modal
        open={!!pendingSlot}
        onClose={() => setPendingSlot(null)}
        title="Agendar cita"
        className="sm:max-w-sm"
      >
        {pendingSlot && (
          <>
            <p className="text-sm text-white/70">
              ¿Agendar una nueva cita el{' '}
              <span className="font-semibold text-white">
                {dateShort(ymd(pendingSlot))}
              </span>{' '}
              a las{' '}
              <span className="font-semibold text-white">
                {timeShort(toLocalNaive(pendingSlot))}
              </span>
              ?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingSlot(null)}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/75 active:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const d = pendingSlot;
                  setPendingSlot(null);
                  navigate(`${ROUTES.appointmentNew}?date=${ymd(d)}`);
                }}
                className="rounded-xl bg-gradient-to-b from-gold-300 to-gold-500 px-4 py-2 text-sm font-semibold text-ink-950 active:scale-95"
              >
                Agendar
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Calendario"
        className="sm:max-w-sm"
      >
        <p className="mb-2 text-xs uppercase tracking-wide text-white/40">
          Vista
        </p>
        <div className="space-y-1.5">
          {(['three', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => {
                setView(v);
                setSource('medusa');
                setMenuOpen(false);
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-sm',
                view === v && source === 'medusa'
                  ? 'border-gold/50 bg-gold/15 text-gold-100'
                  : 'border-white/10 bg-white/[0.03] text-white/75',
              )}
            >
              {VIEW_LABEL[v]}
              {view === v && source === 'medusa' && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>

        <p className="mb-2 mt-5 text-xs uppercase tracking-wide text-white/40">
          Google Calendar
        </p>
        <button
          onClick={() => {
            setSource((s) => (s === 'google' ? 'medusa' : 'google'));
            setMenuOpen(false);
          }}
          className={cn(
            'flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-sm',
            source === 'google'
              ? 'border-gold/50 bg-gold/15 text-gold-100'
              : 'border-white/10 bg-white/[0.03] text-white/75',
          )}
        >
          Ver calendario de Google
          {source === 'google' && <Check className="h-4 w-4" />}
        </button>

        {isGoogleCalendarEnabled() && (
          <>
            <button
              onClick={() => void exportGoogleJson()}
              disabled={exporting}
              className="mt-1.5 flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-white/75 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {exporting ? 'Exportando…' : 'Exportar eventos a JSON'}
            </button>
            <p className="mt-1.5 text-xs leading-relaxed text-white/40">
              Descarga los eventos de Google (−120 / +180 días) para migrarlos o
              revisarlos fuera de la app.
            </p>
            <button
              onClick={() => void checkGoogle()}
              disabled={checking}
              className="mt-1.5 flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-white/75 disabled:opacity-50"
            >
              <PlugZap className="h-4 w-4" />
              {checking ? 'Probando…' : 'Probar conexión con Google'}
            </button>
          </>
        )}
        {exportMsg && (
          <p className="mt-2 text-sm text-white/60">{exportMsg}</p>
        )}
      </Modal>
    </div>
  );
}
