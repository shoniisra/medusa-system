import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Plus,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { query } from '@/lib/db';
import { dateShort, fullName, todayISO } from '@/lib/format';
import { ymd } from '@/lib/date';
import { useOrgId, useBranchId } from '@/store/session';
import {
  Button,
  Card,
  CardHeader,
  DateInput,
  Input,
  Select,
  useToast,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { ROUTES } from '@/config/constants';
import { StaffShell } from './StaffShell';
import type { StaffMember } from '@/types';
import {
  useTimeOff,
  useAddTimeOff,
  useDeleteTimeOff,
} from './useTimeOff';

/** Motivos ofrecidos por el formulario. */
const TIME_OFF_REASONS = [
  'vacaciones',
  'permiso',
  'feriado',
  'cierre',
  'otro',
] as const;

const NO_COLOR = '#64748b';

/** "24 sep 2026" o "24 sep – 3 dic 2026" según el rango. */
function rangeLabel(a: string, b: string): string {
  return a === b ? dateShort(a) : `${dateShort(a)} – ${dateShort(b)}`;
}

/** Cuántos días cubre el rango (inclusivo). */
function daysInRange(a: string, b: string): number {
  const d1 = new Date(`${a}T00:00:00`).getTime();
  const d2 = new Date(`${b}T00:00:00`).getTime();
  return Math.round((d2 - d1) / 86400000) + 1;
}

/** Fecha ISO desplazada N días. */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return ymd(d);
}

/** Pastilla visual con el color del colaborador (gris para cierres del local). */
function Dot({ color }: { color: string | null }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? NO_COLOR }}
    />
  );
}

/* ───────────────────── Página ───────────────────── */

/**
 * Gestión visual de ausencias (vacaciones/permisos por colaboradora) y cierres
 * del local. Vive bajo /personal/ausencias y alimenta la misma tabla time_off
 * que el agendado consulta para bloquear fechas. Incluye:
 *   - Formulario con atajos de rango (hoy, mañana, fin de semana, próximo mes).
 *   - Alerta de conflictos: citas que ya están agendadas durante una ausencia.
 *   - Línea de tiempo (90 días) por colaboradora + fila del local.
 *   - Listas separadas: vigentes ahora / próximas / histórico.
 */
export function AbsencesPage() {
  const orgId = useOrgId();
  const branchId = useBranchId();
  const toast = useToast();
  const timeOff = useTimeOff();
  const add = useAddTimeOff();
  const del = useDeleteTimeOff();

  // Equipo completo (incluye inactivas) para mostrar el nombre de ausencias
  // viejas aunque la persona hoy esté dada de baja.
  const staff = useQuery({
    queryKey: ['staff-all', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffMember>(
        'SELECT * FROM staff_member WHERE organization_id = ? ORDER BY first_name',
        [orgId],
      ),
  });

  const staffById = useMemo(() => {
    const m = new Map<string, StaffMember>();
    for (const s of staff.data ?? []) m.set(s.id, s);
    return m;
  }, [staff.data]);

  const nameOf = (id: string | null): string => {
    if (!id) return 'Todo el local';
    const s = staffById.get(id);
    return s ? fullName(s.first_name, s.last_name) : '—';
  };
  const colorOf = (id: string | null): string | null =>
    id ? (staffById.get(id)?.color ?? null) : null;

  const today = todayISO();
  const rows = timeOff.data ?? [];
  const current = rows.filter((r) => r.start_date <= today && r.end_date >= today);
  const upcoming = rows.filter((r) => r.start_date > today);
  const past = rows.filter((r) => r.end_date < today);

  function remove(id: string, label: string) {
    if (
      !window.confirm(
        `¿Quitar "${label}"? El agendado volverá a permitir esas fechas.`,
      )
    )
      return;
    del.mutate(id, {
      onSuccess: () => toast.success('Listo', 'Se quitó el registro.'),
      onError: (e) =>
        toast.error('No se pudo quitar', e instanceof Error ? e.message : ''),
    });
  }

  // Conflictos: citas futuras (reservadas/confirmadas) que caen dentro de alguna
  // ausencia vigente/futura de su propia colaboradora o dentro de un cierre.
  const conflicts = useConflicts(branchId, timeOff.data);
  // El formulario arranca cerrado: lo primero a la vista es qué pasa hoy
  // (conflictos, vigentes, próximas), no un formulario largo.
  const [formOpen, setFormOpen] = useState(false);

  const Row = ({
    id,
    staffId,
    title,
    sub,
    tone,
  }: {
    id: string;
    staffId: string | null;
    title: string;
    sub: string;
    tone?: 'current';
  }) => (
    <li
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5',
        tone === 'current'
          ? 'border-emerald-400/30 bg-emerald-400/5'
          : 'border-white/10 bg-white/[0.03]',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Dot color={colorOf(staffId)} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">{title}</p>
          <p className="truncate text-xs text-white/50">{sub}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => remove(id, title)}
        className="tap shrink-0 rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-danger"
        title="Quitar"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );

  return (
    <StaffShell
      action={
        <Button onClick={() => setFormOpen((v) => !v)}>
          <Plus className="h-4 w-4" /> Registrar
        </Button>
      }
    >
      {formOpen && (
        <TimeOffForm
          staff={staff.data ?? []}
          onCancel={() => setFormOpen(false)}
          onSubmit={(payload) => {
            add.mutate(payload, {
              onSuccess: () => {
                setFormOpen(false);
                toast.success(
                  'Registrado',
                  payload.staffMemberId
                    ? 'La colaboradora no aparecerá disponible esas fechas.'
                    : 'El local quedará cerrado esas fechas.',
                );
              },
              onError: (e) =>
                toast.error(
                  'No se pudo guardar',
                  e instanceof Error ? e.message : '',
                ),
            });
          }}
          pending={add.isPending}
        />
      )}

      {/* Conflictos con citas ya agendadas: se destaca arriba para que no pase
          desapercibido (ej. Kelly se va el 13 pero ya tenía una cita el 20). */}
      {conflicts.data && conflicts.data.length > 0 && (
        <Card className="border-danger/40">
          <CardHeader
            title={`Citas en conflicto (${conflicts.data.length})`}
            subtitle="Agendadas durante una ausencia o cierre: reasigná o reprogramá."
          />
          <ul className="space-y-2">
            {conflicts.data.map((c) => (
              <li
                key={c.appointment_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {c.customer_name ?? 'Sin cliente'} —{' '}
                      {dateShort(c.start_at.slice(0, 10))} ·{' '}
                      {c.start_at.slice(11, 16)}
                    </p>
                    <p className="truncate text-xs text-white/60">
                      {c.staff_name
                        ? `${c.staff_name} · ${c.reason}`
                        : `Cierre del local · ${c.reason}`}
                    </p>
                  </div>
                </div>
                <Link
                  to={`${ROUTES.appointment}/${c.appointment_id}`}
                  className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
                >
                  Abrir cita
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Lo vigente y lo próximo primero: es lo que se consulta a diario. */}
      <div className="grid gap-3 sm:gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Vigentes ahora"
            subtitle={
              current.length === 0
                ? 'Todo el equipo disponible hoy.'
                : `${current.length} activa${current.length === 1 ? '' : 's'}.`
            }
          />
          {current.length > 0 && (
            <ul className="space-y-2">
              {current.map((r) => (
                <Row
                  key={r.id}
                  id={r.id}
                  staffId={r.staff_member_id}
                  title={nameOf(r.staff_member_id)}
                  sub={`${rangeLabel(r.start_date, r.end_date)}${
                    r.reason ? ` · ${r.reason}` : ''
                  }${r.note ? ` · ${r.note}` : ''}`}
                  tone="current"
                />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Próximas"
            subtitle={
              upcoming.length === 0
                ? 'Nada programado todavía.'
                : `${upcoming.length} programada${upcoming.length === 1 ? '' : 's'}.`
            }
          />
          {upcoming.length > 0 && (
            <ul className="space-y-2">
              {upcoming.map((r) => (
                <Row
                  key={r.id}
                  id={r.id}
                  staffId={r.staff_member_id}
                  title={nameOf(r.staff_member_id)}
                  sub={`${rangeLabel(r.start_date, r.end_date)}${
                    r.reason ? ` · ${r.reason}` : ''
                  }${r.note ? ` · ${r.note}` : ''}`}
                />
              ))}
            </ul>
          )}
        </Card>

      </div>

      {/* Línea de tiempo visual: una fila por recurso con sus ausencias/cierres
          pintadas en una franja de 90 días desde hoy. Ayuda a ver de un vistazo
          "¿cuándo se cruzan vacaciones?" y "¿cuándo cierra el local?". */}
      <TimelineCard
        rows={rows}
        staff={staff.data ?? []}
        staffById={staffById}
      />

      {/* Histórico plegado: rara vez se consulta y empujaba todo hacia abajo. */}
      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-white/70">
            Ya pasaron ({past.length})
          </summary>
          {past.length === 0 ? (
            <p className="mt-3 text-xs text-white/40">Sin histórico aún.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {past.slice(0, 20).map((r) => (
                <Row
                  key={r.id}
                  id={r.id}
                  staffId={r.staff_member_id}
                  title={nameOf(r.staff_member_id)}
                  sub={`${rangeLabel(r.start_date, r.end_date)}${
                    r.reason ? ` · ${r.reason}` : ''
                  }`}
                />
              ))}
            </ul>
          )}
        </details>
      </Card>
    </StaffShell>
  );
}

/* ───────────── Formulario con atajos ───────────── */

interface FormPayload {
  staffMemberId: string | null;
  startDate: string;
  endDate: string;
  reason: string | null;
  note: string | null;
}

function TimeOffForm({
  staff,
  onSubmit,
  onCancel,
  pending,
}: {
  staff: StaffMember[];
  onSubmit: (p: FormPayload) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [staffId, setStaffId] = useState('');
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [reason, setReason] = useState<string>('vacaciones');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  // Atajos de rango: setean inicio+fin juntos. "Semana" = la actual (lun–dom);
  // "fin de semana" = próximo sábado+domingo; "próximo mes" = primer día al último.
  const quickRanges = useMemo(() => {
    const now = new Date();
    const todayIso = todayISO();
    const tomorrow = shiftDays(todayIso, 1);
    // Lunes de esta semana (0=dom, 1=lun ... 6=sáb).
    const dow = now.getDay();
    const toMon = dow === 0 ? -6 : 1 - dow;
    const weekStart = shiftDays(todayIso, toMon);
    const weekEnd = shiftDays(weekStart, 6);
    // Próximo fin de semana: próximo sábado y domingo.
    const toSat = dow === 6 ? 7 : 6 - dow;
    const satIso = shiftDays(todayIso, toSat);
    const sunIso = shiftDays(satIso, 1);
    // Próximo mes completo.
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return [
      { label: 'Hoy', from: todayIso, to: todayIso },
      { label: 'Mañana', from: tomorrow, to: tomorrow },
      { label: 'Esta semana', from: weekStart, to: weekEnd },
      { label: 'Fin de semana', from: satIso, to: sunIso },
      { label: 'Próximo mes', from: ymd(nextMonthStart), to: ymd(nextMonthEnd) },
    ];
  }, []);

  function submit() {
    setError('');
    if (!start || !end) {
      setError('Elegí las fechas de inicio y fin.');
      return;
    }
    if (end < start) {
      setError('La fecha de fin no puede ser anterior al inicio.');
      return;
    }
    onSubmit({
      staffMemberId: staffId || null,
      startDate: start,
      endDate: end,
      reason: reason || null,
      note: note.trim() || null,
    });
    // Dejamos reason/alcance; limpiamos nota para no repetirla en el próximo alta.
    setNote('');
  }

  const totalDays = daysInRange(start, end);

  return (
    <Card>
      <CardHeader
        title="Registrar ausencia o cierre"
        subtitle="El agendado dejará de ofrecer esas fechas."
      />
      <div className="space-y-3 sm:space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-white/60">
              ¿A quién afecta?
            </span>
            <Select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">Todo el local (cierre)</option>
              {staff
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {fullName(s.first_name, s.last_name)}
                  </option>
                ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-white/60">
              Motivo
            </span>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {TIME_OFF_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {/* Atajos de rango: evitan tener que elegir desde/hasta a mano para los
            casos más frecuentes. */}
        <div className="flex flex-wrap gap-1.5">
          {quickRanges.map((q) => {
            const on = start === q.from && end === q.to;
            return (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  setStart(q.from);
                  setEnd(q.to);
                }}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs transition active:scale-[0.97]',
                  on
                    ? 'border-gold/60 bg-gold/15 text-gold-100'
                    : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]',
                )}
              >
                {q.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-[1fr_1fr_auto]">
          <DateInput
            label="Desde"
            value={start}
            onChange={(v) => {
              if (!v) return;
              setStart(v);
              if (end < v) setEnd(v);
            }}
            clearable={false}
          />
          <DateInput
            label="Hasta"
            value={end}
            min={start}
            onChange={(v) => v && setEnd(v)}
            clearable={false}
          />
          <div className="col-span-2 flex items-end md:col-span-1">
            <div className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-white/40">
                Total
              </p>
              <p className="text-sm font-semibold text-white">
                {totalDays} día{totalDays === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </div>

        <Input
          label="Nota (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ej. fuera del país, evento, feriado nacional…"
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-white/40">
            {staffId
              ? `${fullName(
                  staff.find((s) => s.id === staffId)?.first_name ?? '',
                  staff.find((s) => s.id === staffId)?.last_name ?? null,
                )} no aparecerá disponible en el agendado.`
              : 'El local quedará cerrado para todas las colaboradoras.'}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button loading={pending} onClick={submit}>
              <Plus className="h-4 w-4" /> Guardar
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ───────────── Línea de tiempo (90 días) ───────────── */

interface TimelineRange {
  id: string;
  staff_member_id: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
}

/** Ventana fija de 90 días desde hoy, para pintar barras tipo Gantt. */
const TIMELINE_DAYS = 90;

function TimelineCard({
  rows,
  staff,
  staffById,
}: {
  rows: TimelineRange[];
  staff: StaffMember[];
  staffById: Map<string, StaffMember>;
}) {
  const today = useMemo(() => todayISO(), []);
  const endIso = useMemo(() => shiftDays(today, TIMELINE_DAYS - 1), [today]);

  // Nos quedamos solo con los rangos que cruzan la ventana (vigentes o futuros
  // dentro de los próximos TIMELINE_DAYS días).
  const visible = useMemo(
    () =>
      rows.filter((r) => r.end_date >= today && r.start_date <= endIso),
    [rows, today, endIso],
  );

  // Agrupamos por recurso: fila "Local" + una por cada colaboradora que tenga
  // al menos una ausencia visible. Si no hay nada, no mostramos la tarjeta.
  const grouped = useMemo(() => {
    const m = new Map<string, TimelineRange[]>();
    for (const r of visible) {
      const k = r.staff_member_id ?? '__local';
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return m;
  }, [visible]);

  // Hitos: marcas verticales para "hoy", "en 30 días", "en 60 días", fin ventana.
  // Están pensados para dar escala sin saturar el eje.
  const marks = useMemo(() => {
    return [0, 30, 60, TIMELINE_DAYS - 1].map((d) => ({
      offset: d,
      label:
        d === 0
          ? 'Hoy'
          : d === TIMELINE_DAYS - 1
            ? `+${TIMELINE_DAYS}d`
            : `+${d}d`,
      iso: shiftDays(today, d),
    }));
  }, [today]);

  // Sin nada a la vista no se pinta: "Vigentes" y "Próximas" ya lo dicen.
  if (grouped.size === 0) return null;

  // Resolver color de barra: el del colaborador, o rojo para cierres del local.
  const colorFor = (staffId: string | null): string =>
    staffId
      ? (staffById.get(staffId)?.color ?? NO_COLOR)
      : 'var(--danger, #ef4444)';

  // Convertimos "YYYY-MM-DD" a offset de día desde hoy (clamp a la ventana).
  function dayOffset(iso: string): number {
    const d = new Date(`${iso}T00:00:00`).getTime();
    const t = new Date(`${today}T00:00:00`).getTime();
    return Math.max(
      0,
      Math.min(TIMELINE_DAYS - 1, Math.round((d - t) / 86400000)),
    );
  }

  // Keys ordenadas: Local primero, luego colaboradoras por nombre.
  const orderedKeys = [...grouped.keys()].sort((a, b) => {
    if (a === '__local') return -1;
    if (b === '__local') return 1;
    const na =
      staff.find((s) => s.id === a)?.first_name?.toLowerCase() ?? '';
    const nb =
      staff.find((s) => s.id === b)?.first_name?.toLowerCase() ?? '';
    return na.localeCompare(nb);
  });

  const bgStripe: CSSProperties = {
    // Franjas verticales suaves cada 7 días (semanas) como guía visual.
    backgroundImage:
      'repeating-linear-gradient(to right, rgba(255,255,255,0.03) 0, rgba(255,255,255,0.03) 1px, transparent 1px, transparent calc(100%/13))',
  };

  return (
    <Card>
      <CardHeader
        title="Línea de tiempo"
        subtitle={`Próximos ${TIMELINE_DAYS} días · ${visible.length} rango${visible.length === 1 ? '' : 's'} visible${visible.length === 1 ? '' : 's'}.`}
      />

      {/* Sin ancho mínimo: en el teléfono la franja se comprime en vez de
          obligar a scrollear de costado. */}
      <div>
        <div className="space-y-2">
          {/* Eje con hitos, alineado con la franja (misma columna de nombre). */}
          <div className="flex gap-2 text-[10px] text-white/40 sm:gap-3">
            <div className="w-20 shrink-0 sm:w-32" />
            <div className="relative h-5 flex-1">
              {marks.map((m) => (
                <div
                  key={m.offset}
                  className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
                  style={{
                    left: `${(m.offset / (TIMELINE_DAYS - 1)) * 100}%`,
                  }}
                >
                  <span className="whitespace-nowrap">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {orderedKeys.map((k) => {
            const items = grouped.get(k) ?? [];
            const isLocal = k === '__local';
            const label = isLocal
              ? 'Todo el local'
              : fullName(
                  staffById.get(k)?.first_name ?? '—',
                  staffById.get(k)?.last_name ?? null,
                );
            const color = colorFor(isLocal ? null : k);
            return (
              <div key={k} className="flex items-center gap-2 sm:gap-3">
                <div className="flex w-20 shrink-0 items-center gap-2 truncate text-xs text-white/70 sm:w-32">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">{label}</span>
                </div>
                <div
                  className="relative h-7 flex-1 rounded-lg border border-white/5 bg-white/[0.02]"
                  style={bgStripe}
                >
                  {items.map((r) => {
                    const from = dayOffset(r.start_date);
                    const to = dayOffset(r.end_date);
                    const leftPct = (from / (TIMELINE_DAYS - 1)) * 100;
                    // El ancho mínimo asegura que un rango de 1 día se vea.
                    const widthPct = Math.max(
                      1.2,
                      ((to - from + 1) / TIMELINE_DAYS) * 100,
                    );
                    return (
                      <div
                        key={r.id}
                        title={`${rangeLabel(r.start_date, r.end_date)}${
                          r.reason ? ` · ${r.reason}` : ''
                        }`}
                        className="absolute top-1 h-5 rounded-md"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          backgroundColor: color,
                          opacity: 0.75,
                          // Borde interno para dar algo de contraste sobre su propio color.
                          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25)',
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/* ───────────── Hook de conflictos ───────────── */

interface ConflictRow {
  appointment_id: string;
  start_at: string;
  customer_name: string | null;
  staff_name: string | null;
  reason: string | null;
}

/**
 * Cita futura (reservada o confirmada) que cae dentro de una ausencia o cierre.
 * No filtra por `active=1` de time_off en código porque useTimeOff ya trae solo
 * las vigentes; acá cruzamos esas filas con las citas en la base.
 */
function useConflicts(
  branchId: string,
  timeOff: TimelineRange[] | undefined,
) {
  const today = todayISO();
  const stable = (timeOff ?? [])
    .filter((r) => r.end_date >= today)
    .map((r) => `${r.id}:${r.staff_member_id ?? ''}:${r.start_date}:${r.end_date}`)
    .join(',');

  return useQuery({
    queryKey: ['time-off-conflicts', branchId, stable],
    enabled: !!branchId && (timeOff?.length ?? 0) > 0,
    queryFn: async (): Promise<ConflictRow[]> => {
      // Para cada ausencia/cierre, buscamos citas vivas dentro del rango que
      // ya tengan asignada la misma colaboradora (o cualquier colaboradora si
      // es un cierre del local).
      const rows = timeOff!.filter((r) => r.end_date >= today);
      const out: ConflictRow[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        const result = await query<ConflictRow>(
          `SELECT DISTINCT a.id AS appointment_id,
                  a.start_at,
                  (c.first_name || CASE WHEN c.last_name IS NOT NULL
                                        THEN ' ' || c.last_name ELSE '' END) AS customer_name,
                  (sm.first_name || CASE WHEN sm.last_name IS NOT NULL
                                         THEN ' ' || sm.last_name ELSE '' END) AS staff_name,
                  ? AS reason
             FROM appointment a
             LEFT JOIN appointment_item ai ON ai.appointment_id = a.id
             LEFT JOIN staff_member sm ON sm.id = ai.assigned_staff_id
             LEFT JOIN customer c ON c.id = a.customer_id
            WHERE a.branch_id = ?
              AND a.status IN ('reserved','confirmed')
              AND substr(a.start_at, 1, 10) BETWEEN ? AND ?
              ${r.staff_member_id ? 'AND ai.assigned_staff_id = ?' : ''}
            ORDER BY a.start_at ASC`,
          r.staff_member_id
            ? [
                r.reason ?? (r.staff_member_id ? 'ausencia' : 'cierre'),
                branchId,
                r.start_date,
                r.end_date,
                r.staff_member_id,
              ]
            : [r.reason ?? 'cierre', branchId, r.start_date, r.end_date],
        );
        for (const row of result) {
          // Deduplica: una misma cita puede coincidir con varios rangos.
          if (seen.has(row.appointment_id)) continue;
          seen.add(row.appointment_id);
          out.push(row);
        }
      }
      // Más próximas arriba.
      return out.sort((a, b) => a.start_at.localeCompare(b.start_at));
    },
  });
}
