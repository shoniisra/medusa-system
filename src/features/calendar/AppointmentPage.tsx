import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Scissors,
  Package,
  Check,
  UserRound,
  AlertTriangle,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './agenda-calendar.css';
import { query, queryOne, batch, execute } from '@/lib/db';
import {
  genId,
  money,
  num,
  fullName,
  toLocalNaive,
  dateShort,
  timeShort,
} from '@/lib/format';
import { useOrgId, useBranchId, useSession } from '@/store/session';
import { useCustomers, useServices, useProducts, useStaff } from '@/features/pos/useCatalog';
import {
  DEFAULT_SERVICE_MINUTES,
  toMinutes,
  hoursForDate,
  overlaps,
  type Interval,
} from '@/config/schedule';
import { cn } from '@/lib/cn';
import { SERVICE_CATEGORIES, APPOINTMENT_STATUS } from '@/config/constants';
import { ROUTES } from '@/config/constants';
import {
  isGoogleCalendarEnabled,
  createCalendarEvent,
  updateCalendarEvent,
} from '@/lib/googleCalendar';
import {
  Button,
  Card,
  CardHeader,
  Input,
  Select,
  EmptyState,
  Badge,
  Modal,
  PhoneInput,
} from '@/components/ui';
import { findCustomerByPhone } from '@/features/clients/customerLookup';
import {
  createSale,
  loadCommissionRules,
  commissionForItem,
} from '@/features/pos/createSale';
import type {
  AppointmentStatus,
  BankAccount,
  CashSession,
  DraftCommission,
  DraftSaleItem,
  PaymentMethod,
} from '@/types';

export function AppointmentPage() {
  const { id } = useParams();
  return id ? <EditAppointment id={id} /> : <NewAppointment />;
}

/** Minutos → "1 h 30 min" / "45 min". */
function fmtDuration(min: number): string {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/** Fecha/hora almacenada → minutos del día (según la hora que se ve en agenda). */
function naiveToMin(s: string): number {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return toMinutes(s.slice(11, 16));
  return d.getHours() * 60 + d.getMinutes();
}

/** "YYYY-MM-DD" de hoy en hora local. */
function todayLocalISO(): string {
  return toLocalNaive(new Date()).slice(0, 10);
}

/** Etiqueta corta de día: { wd: 'lun', dm: '24 sep' }. */
function dayLabel(iso: string): { wd: string; dm: string } {
  const d = new Date(`${iso}T00:00:00`);
  return {
    wd: d.toLocaleDateString('es-EC', { weekday: 'short' }).replace('.', ''),
    dm: d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }),
  };
}

/** Localizer español para react-big-calendar (selector de día y hora). */
const rbcLocalizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales: { es },
});

const rbcMessages = {
  today: 'Hoy',
  previous: '‹',
  next: '›',
  week: 'Semana',
  day: 'Día',
  date: 'Fecha',
  time: 'Hora',
  event: 'Cita',
  noEventsInRange: 'Sin citas.',
};

/** "YYYY-MM-DD" local de un Date. */
function ymdLocal(d: Date): string {
  return toLocalNaive(d).slice(0, 10);
}

/* ═══════════════════════════ Nueva cita ═══════════════════════════ */

/** Categoría de servicio elegida al agendar, con su estilista (opcional). */
interface DraftCat {
  category: string;
  staffId: string;
}

function NewAppointment() {
  const navigate = useNavigate();
  const orgId = useOrgId();
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  const [params] = useSearchParams();

  const customers = useCustomers();
  const staff = useStaff();

  // Paso del asistente: 1) qué y cuándo · 2) cliente y confirmación.
  const [step, setStep] = useState<1 | 2>(1);

  // Cliente
  const [newClient, setNewClient] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  // Fecha / hora / abono
  const [date, setDate] = useState(params.get('date') || todayLocalISO());
  const [time, setTime] = useState('10:00');
  const [deposit, setDeposit] = useState('0');
  const [customDeposit, setCustomDeposit] = useState(false);
  // El abono debe elegirse explícitamente (5/10/20/Otro) antes de agendar.
  const [depositChosen, setDepositChosen] = useState(false);

  // Categorías elegidas (con estilista opcional por categoría).
  const [cats, setCats] = useState<DraftCat[]>([]);
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);

  // Vista del calendario: en móvil arranca en "Día"; en escritorio en "Semana".
  const [calView, setCalView] = useState<View>(() =>
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 768px)').matches
      ? 'day'
      : 'week',
  );

  const hasClient = !!customerId || newClient;
  const selectedCustomer = customers.data?.find((c) => c.id === customerId);

  // ── Cliente: buscador con foco automático y creación al vuelo ──
  useEffect(() => {
    if (step === 2 && !hasClient) searchRef.current?.focus();
  }, [step, hasClient]);

  const clientMatches = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const list = customers.data ?? [];
    if (!q) return [];
    return list
      .filter(
        (c) =>
          fullName(c.first_name, c.last_name).toLowerCase().includes(q) ||
          (c.phone ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [customers.data, clientSearch]);

  function pickExisting(c: { id: string }) {
    setCustomerId(c.id);
    setNewClient(false);
    setClientSearch('');
  }

  function startNewClient() {
    const parts = clientSearch.trim().split(/\s+/).filter(Boolean);
    setFirstName(parts[0] ?? '');
    setLastName(parts.slice(1).join(' '));
    setNewClient(true);
    setCustomerId('');
    setTimeout(() => phoneRef.current?.focus(), 0);
  }

  function clearClient() {
    setNewClient(false);
    setCustomerId('');
    setFirstName('');
    setLastName('');
    setPhone('');
    setClientSearch('');
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  // ── Categorías ──
  function toggleCat(category: string) {
    setCats((cs) =>
      cs.some((c) => c.category === category)
        ? cs.filter((c) => c.category !== category)
        : [...cs, { category, staffId: '' }],
    );
    setConflicts([]);
  }
  function setCatStaff(category: string, staffId: string) {
    setCats((cs) =>
      cs.map((c) => (c.category === category ? { ...c, staffId } : c)),
    );
    setConflicts([]);
  }
  const isCatOn = (category: string) => cats.some((c) => c.category === category);

  const staffName = (sid: string) => {
    const s = staff.data?.find((x) => x.id === sid);
    return s ? fullName(s.first_name, s.last_name) : 'Sin asignar';
  };

  const dep = Number(deposit) || 0;

  // Cobro de la seña al reservar: destino (banco por defecto principal, o caja).
  const [depositDest, setDepositDest] = useState('');
  const banks = useQuery({
    queryKey: ['bank-accounts', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<BankAccount>(
        'SELECT * FROM bank_account WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });
  const payMethods = useQuery({
    queryKey: ['payment-methods', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });
  const openCash = useQuery({
    queryKey: ['open-cash', branchId],
    enabled: !!branchId,
    queryFn: () =>
      queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'open'
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      ),
  });
  const cashMethod = payMethods.data?.find((m) => m.method_type === 'cash');
  const transferMethod = payMethods.data?.find((m) => m.method_type === 'transfer');
  const firstBankId = banks.data?.[0]?.id ?? '';
  const effectiveDest = depositDest || firstBankId || 'cash';
  const depositIsCash = effectiveDest === 'cash';

  // Tiempo reservado: sin servicios todavía, se estima DEFAULT_SERVICE_MINUTES por
  // categoría, apilando las del mismo estilista (las de distinto van en paralelo).
  const staffBlocks = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cats) {
      const k = c.staffId || '__none';
      m.set(k, (m.get(k) ?? 0) + DEFAULT_SERVICE_MINUTES);
    }
    return m;
  }, [cats]);
  const reservedMinutes = cats.length ? Math.max(...staffBlocks.values()) : 0;

  // Citas de la semana visible (para pintar disponibilidad en el calendario y
  // chequear solapes del día elegido). Una sola consulta por semana.
  const weekStart = useMemo(
    () => startOfWeek(new Date(`${date}T00:00:00`), { weekStartsOn: 1 }),
    [date],
  );
  const weekFrom = ymdLocal(weekStart);
  const weekTo = ymdLocal(new Date(weekStart.getTime() + 6 * 86400000));

  const weekAppts = useQuery({
    queryKey: ['week-availability', branchId, weekFrom],
    enabled: !!branchId,
    queryFn: () =>
      query<{
        id: string;
        start_at: string;
        end_at: string;
        staff_id: string | null;
        staff_color: string | null;
        cust: string | null;
      }>(
        `SELECT a.id, a.start_at, a.end_at,
                ai.assigned_staff_id AS staff_id,
                s.color AS staff_color,
                c.first_name AS cust
           FROM appointment a
           JOIN appointment_item ai ON ai.appointment_id = a.id
           LEFT JOIN staff_member s ON s.id = ai.assigned_staff_id
           LEFT JOIN customer c ON c.id = a.customer_id
          WHERE a.branch_id = ?
            AND a.status NOT IN ('cancelled', 'no_show')
            AND substr(a.start_at, 1, 10) BETWEEN ? AND ?
          GROUP BY a.id, ai.assigned_staff_id`,
        [branchId, weekFrom, weekTo],
      ),
  });

  const bookedByStaff = useMemo(() => {
    const m = new Map<string, Interval[]>();
    for (const r of weekAppts.data ?? []) {
      if (!r.staff_id) continue;
      if (r.start_at.slice(0, 10) !== date) continue;
      const arr = m.get(r.staff_id) ?? [];
      arr.push({ startMin: naiveToMin(r.start_at), endMin: naiveToMin(r.end_at) });
      m.set(r.staff_id, arr);
    }
    return m;
  }, [weekAppts.data, date]);

  // Eventos del calendario: citas ocupadas (color del estilista, atenuadas) + el
  // bloque propuesto en dorado.
  const calEvents = useMemo(() => {
    const busy = (weekAppts.data ?? []).map((r) => ({
      id: r.id,
      title: r.cust || 'Ocupado',
      start: new Date(r.start_at),
      end: new Date(r.end_at),
      color: r.staff_color || '#64748b',
      proposed: false,
    }));
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(
      start.getTime() + (reservedMinutes || DEFAULT_SERVICE_MINUTES) * 60000,
    );
    busy.push({
      id: '__proposed',
      title: 'Tu cita',
      start,
      end,
      color: '#f4c752',
      proposed: true,
    });
    return busy;
  }, [weekAppts.data, date, time, reservedMinutes]);

  /** Revisa horario del local + solape por estilista. Devuelve avisos. */
  function checkAvailability(): string[] {
    const startMin = toMinutes(time);
    const warnings: string[] = [];

    const hours = hoursForDate(date);
    if (!hours) {
      warnings.push('El local está cerrado ese día.');
    } else if (
      startMin < toMinutes(hours.open) ||
      startMin + reservedMinutes > toMinutes(hours.close)
    ) {
      warnings.push(`Fuera del horario del local (${hours.open}–${hours.close}).`);
    }

    for (const [key, dur] of staffBlocks) {
      if (key === '__none') continue;
      const booked = bookedByStaff.get(key) ?? [];
      if (overlaps(booked, startMin, startMin + dur)) {
        warnings.push(`${staffName(key)} ya tiene una cita en ese horario.`);
      }
    }
    return warnings;
  }

  const save = useMutation({
    mutationFn: async () => {
      if (cats.length === 0) throw new Error('Elegí al menos una categoría.');
      if (!newClient && !customerId)
        throw new Error('Elegí un cliente o creá uno nuevo.');
      if (newClient && !firstName.trim())
        throw new Error('El nombre del cliente es obligatorio.');

      const newPhone = newClient ? phone.trim() : '';
      if (newClient && newPhone) {
        const hit = await findCustomerByPhone(orgId, newPhone);
        if (hit) {
          throw new Error(
            `Ese número ya es de ${fullName(hit.first_name, hit.last_name)}. Buscalo en la lista en vez de crear uno nuevo.`,
          );
        }
      }

      const start = new Date(`${date}T${time}:00`);
      const end = new Date(
        start.getTime() + (reservedMinutes || DEFAULT_SERVICE_MINUTES) * 60000,
      );
      const startLocal = toLocalNaive(start);
      const endLocal = toLocalNaive(end);

      let custId = customerId || null;
      if (newClient) custId = genId();

      const clientLabel = newClient
        ? fullName(firstName, lastName)
        : fullName(
            selectedCustomer?.first_name ?? '',
            selectedCustomer?.last_name,
          );

      // Google Calendar: se sincroniza siempre que esté configurado.
      let googleEventId: string | null = null;
      let calendarId: string | null = null;
      if (isGoogleCalendarEnabled()) {
        const branchRow = await queryOne<{ google_calendar_id: string | null }>(
          'SELECT google_calendar_id FROM branch WHERE id = ?',
          [branchId],
        );
        calendarId = branchRow?.google_calendar_id ?? null;
        const firstAssigned = cats.find((c) => c.staffId)?.staffId ?? null;
        const firstStaff = staff.data?.find((x) => x.id === firstAssigned);
        try {
          const descLines = cats.map(
            (c) => `• ${c.category} — ${staffName(c.staffId)}`,
          );
          descLines.push('');
          descLines.push(`Abono: ${money(dep)}`);
          descLines.push('Detalle y total: se cargan al atender.');
          googleEventId = await createCalendarEvent({
            summary: `${cats.map((c) => c.category).join(', ')} — ${clientLabel} (abono ${money(dep)})`,
            description: descLines.join('\n'),
            startLocal,
            endLocal,
            calendarId,
            colorHex: firstStaff?.color,
          });
        } catch {
          googleEventId = null;
        }
      }

      const apptId = genId();
      const stmts: { sql: string; args: (string | number | null)[] }[] = [];

      if (newClient) {
        stmts.push({
          sql: `INSERT INTO customer (id, organization_id, first_name, last_name, phone)
                VALUES (?, ?, ?, ?, ?)`,
          args: [custId, orgId, firstName.trim(), lastName.trim() || null, newPhone || null],
        });
      }

      stmts.push({
        sql: `INSERT INTO appointment
                (id, organization_id, branch_id, customer_id, start_at, end_at,
                 status, deposit_required, deposit_amount, google_calendar_id,
                 google_calendar_event_id, created_by)
              VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?)`,
        args: [
          apptId,
          orgId,
          branchId,
          custId,
          startLocal,
          endLocal,
          dep > 0 ? 1 : 0,
          dep,
          calendarId,
          googleEventId,
          userId,
        ],
      });

      // Una fila por categoría: sin servicio todavía (service_id/product_id NULL),
      // el estilista queda asignado y el detalle se completa en Atención.
      for (const c of cats) {
        stmts.push({
          sql: `INSERT INTO appointment_item
                  (id, appointment_id, service_id, product_id, category, description,
                   quantity, list_unit_price, discount_amount, final_unit_price,
                   assigned_staff_id)
                VALUES (?, ?, NULL, NULL, ?, ?, 1, 0, 0, 0, ?)`,
          args: [genId(), apptId, c.category, c.category, c.staffId || null],
        });
      }

      // Cobro de la seña: ingreso atado a la cita (sale_id NULL). Efectivo entra
      // a la caja abierta; transferencia va a la cuenta bancaria elegida.
      if (dep > 0) {
        const method = depositIsCash ? cashMethod : transferMethod;
        if (!method)
          throw new Error(
            `No hay un método de pago ${depositIsCash ? 'en efectivo' : 'por transferencia'} configurado.`,
          );
        const bankId = depositIsCash ? null : effectiveDest;
        const paymentId = genId();
        const nowIso = new Date().toISOString();
        stmts.push({
          sql: `INSERT INTO payment
                  (id, organization_id, branch_id, sale_id, appointment_id, payment_method_id,
                   bank_account_id, paid_at, amount, status, reference)
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            paymentId,
            orgId,
            branchId,
            apptId,
            method.id,
            bankId,
            nowIso,
            dep,
            `[Seña] ${clientLabel}`,
          ],
        });
        if (depositIsCash && openCash.data?.id) {
          stmts.push({
            sql: `INSERT INTO cash_movement
                    (id, cash_session_id, branch_id, movement_type, direction, amount,
                     movement_at, payment_id, description, created_by)
                  VALUES (?, ?, ?, 'cash_in', 'in', ?, ?, ?, ?, ?)`,
            args: [
              genId(),
              openCash.data.id,
              branchId,
              dep,
              nowIso,
              paymentId,
              `Seña ${clientLabel}`,
              userId,
            ],
          });
        }
      }

      await batch(stmts);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['customers', orgId] });
      navigate(ROUTES.calendar);
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'No se pudo agendar.'),
  });

  function attemptSchedule(force: boolean) {
    setError('');
    if (cats.length === 0) return;
    if (!force) {
      const warnings = checkAvailability();
      if (warnings.length) {
        setConflicts(warnings);
        return;
      }
    }
    setConflicts([]);
    save.mutate();
  }

  const canContinue = cats.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-24">
      <Header
        title="Agendar cita"
        onBack={() =>
          step === 2 ? setStep(1) : navigate(ROUTES.calendar)
        }
      />

      {/* Indicador de pasos */}
      <div className="flex items-center gap-2 text-sm">
        <StepDot n={1} label="Qué y cuándo" active={step === 1} done={step > 1} />
        <span className="h-px flex-1 bg-white/10" />
        <StepDot n={2} label="Cliente y abono" active={step === 2} done={false} />
      </div>

      {step === 1 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Categorías + estilista */}
          <Card>
            <CardHeader
              title="¿Qué se va a hacer?"
              subtitle="Tocá una o varias categorías. El detalle se carga al atender."
            />
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {SERVICE_CATEGORIES.map((c) => {
                const on = isCatOn(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCat(c)}
                    className={cn(
                      'flex min-h-[64px] items-center justify-center rounded-2xl border p-3 text-center text-sm font-medium transition active:scale-[0.97]',
                      on
                        ? 'border-gold/60 bg-gold/15 text-gold-100 shadow-gold-glow'
                        : 'border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/[0.06]',
                    )}
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            {cats.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-white/50">
                  Estilista por categoría (opcional)
                </p>
                {cats.map((c) => (
                  <div
                    key={c.category}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5"
                  >
                    <span className="min-w-[92px] shrink-0 text-sm font-medium text-white">
                      {c.category}
                    </span>
                    <div className="flex-1">
                      <Select
                        value={c.staffId}
                        onChange={(e) => setCatStaff(c.category, e.target.value)}
                      >
                        <option value="">Sin asignar</option>
                        {staff.data?.map((s) => (
                          <option key={s.id} value={s.id}>
                            {fullName(s.first_name, s.last_name)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleCat(c.category)}
                      className="rounded-lg p-2 text-white/40 hover:bg-white/10 hover:text-white"
                      title="Quitar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Disponibilidad: React Big Calendar */}
          <Card>
            <CardHeader
              title="¿Cuándo?"
              subtitle="Tocá un hueco libre. En dorado, tu cita."
            />
            <SlotPicker
              events={calEvents}
              date={new Date(`${date}T${time}:00`)}
              view={calView}
              onView={setCalView}
              onNavigate={(d) => {
                setDate(ymdLocal(d));
                setConflicts([]);
              }}
              onSelectSlot={(start) => {
                setDate(ymdLocal(start));
                setTime(
                  `${String(start.getHours()).padStart(2, '0')}:${String(
                    start.getMinutes(),
                  ).padStart(2, '0')}`,
                );
                setConflicts([]);
              }}
            />
            <p className="mt-3 flex items-center justify-between text-sm">
              <span className="text-white/50">Elegido</span>
              <span className="font-medium text-white">
                {dayLabel(date).wd} {dayLabel(date).dm} · {time} ·{' '}
                <span className="text-white/50">
                  {fmtDuration(reservedMinutes || DEFAULT_SERVICE_MINUTES)}
                </span>
              </span>
            </p>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Cliente */}
          <Card>
            <CardHeader title="Cliente" />

            {hasClient ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-gold-200">
                    {newClient ? (
                      <UserPlus className="h-4 w-4" />
                    ) : (
                      <UserRound className="h-4 w-4" />
                    )}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {newClient
                        ? fullName(firstName, lastName) || 'Cliente nuevo'
                        : fullName(
                            selectedCustomer?.first_name ?? '',
                            selectedCustomer?.last_name,
                          )}
                    </p>
                    <p className="text-xs text-white/40">
                      {newClient
                        ? 'Se creará como cliente nuevo'
                        : selectedCustomer?.phone || 'Sin WhatsApp'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={clearClient}
                  className="rounded-lg p-2 text-white/40 hover:bg-white/10 hover:text-white"
                  title="Cambiar cliente"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                  <input
                    ref={searchRef}
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (clientMatches.length > 0) pickExisting(clientMatches[0]);
                        else if (clientSearch.trim()) startNewClient();
                      }
                    }}
                    placeholder="Buscar cliente por nombre o WhatsApp…"
                    className="input-base w-full pl-9"
                  />
                </div>

                {clientSearch.trim() && (
                  <ul className="max-h-56 divide-y divide-white/5 overflow-y-auto rounded-xl border border-white/10">
                    {clientMatches.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => pickExisting(c)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/10"
                        >
                          <span className="text-sm text-white/90">
                            {fullName(c.first_name, c.last_name)}
                          </span>
                          {c.phone && (
                            <span className="text-xs text-white/40">{c.phone}</span>
                          )}
                        </button>
                      </li>
                    ))}

                    <li>
                      <button
                        onClick={startNewClient}
                        className="flex w-full items-center gap-2 px-3 py-3 text-left text-gold-200 hover:bg-white/10"
                      >
                        <UserPlus className="h-4 w-4 shrink-0" />
                        <span className="text-sm">
                          {clientMatches.length === 0 ? (
                            <>Crear «{clientSearch.trim()}» como cliente nuevo</>
                          ) : (
                            <>Crear «{clientSearch.trim()}» como cliente nuevo</>
                          )}
                        </span>
                      </button>
                    </li>
                  </ul>
                )}
              </div>
            )}

            {newClient && (
              <div className="mt-3">
                <PhoneInput
                  ref={phoneRef}
                  label="WhatsApp"
                  value={phone}
                  onChange={setPhone}
                />
              </div>
            )}
          </Card>

          {/* Pago / abono */}
          <Card gold>
            <CardHeader
              title="Pago"
              subtitle="Elegí el abono para reservar la cita"
            />
            <div className="space-y-4">
              <div>
                <span className="mb-2 block text-sm font-medium text-white/80">
                  Abono <span className="text-danger">*</span>
                </span>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {[5, 10, 20].map((v) => {
                    const active =
                      depositChosen && !customDeposit && deposit === String(v);
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          setDeposit(String(v));
                          setCustomDeposit(false);
                          setDepositChosen(true);
                        }}
                        className={cn(
                          'min-h-[52px] rounded-xl border text-base font-semibold transition active:scale-[0.97]',
                          active
                            ? 'border-gold/60 bg-gold/15 text-gold-100 shadow-gold-glow'
                            : 'border-white/10 text-white/70 hover:bg-white/5',
                        )}
                      >
                        {money(v)}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setCustomDeposit(true);
                      setDeposit('0');
                      setDepositChosen(true);
                    }}
                    className={cn(
                      'min-h-[52px] rounded-xl border text-base font-semibold transition active:scale-[0.97]',
                      depositChosen && customDeposit
                        ? 'border-gold/60 bg-gold/15 text-gold-100 shadow-gold-glow'
                        : 'border-white/10 text-white/70 hover:bg-white/5',
                    )}
                  >
                    Otro
                  </button>
                </div>
                {customDeposit && (
                  <Input
                    className="mt-2"
                    type="number"
                    min="0"
                    step="0.01"
                    autoFocus
                    placeholder="Valor del abono (0 = sin abono)"
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                  />
                )}
                {!depositChosen && (
                  <p className="mt-2 text-xs text-white/40">
                    Tocá una opción de abono para poder agendar.
                  </p>
                )}
              </div>

              {dep > 0 && (
                <div className="space-y-1">
                  <span className="block text-xs font-medium text-white/60">
                    Cobrar seña en
                  </span>
                  <Select
                    value={effectiveDest}
                    onChange={(e) => setDepositDest(e.target.value)}
                  >
                    {banks.data?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} (transferencia)
                      </option>
                    ))}
                    <option value="cash">Efectivo (caja)</option>
                  </Select>
                  {depositIsCash && !openCash.data && (
                    <p className="flex items-center gap-1.5 text-xs text-amber-300/80">
                      <AlertTriangle className="h-3.5 w-3.5" /> No hay caja
                      abierta: la seña se registra pero no entra al efectivo.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Resumen (ancho completo) */}
          <Card className="lg:col-span-2">
            <CardHeader title="Resumen" />
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/50">Cuándo</span>
                  <span className="font-medium text-white">
                    {dayLabel(date).wd} {dayLabel(date).dm} · {time}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-white/50">Tiempo reservado</span>
                  <span className="font-medium text-white">
                    {fmtDuration(reservedMinutes || DEFAULT_SERVICE_MINUTES)}
                  </span>
                </div>
                {depositChosen && (
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-white/50">Abono</span>
                    <span className="kpi-gold font-medium">{money(dep)}</span>
                  </div>
                )}
                <ul className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
                  {cats.map((c) => (
                    <li
                      key={c.category}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-white/80">{c.category}</span>
                      <span className="text-white/50">{staffName(c.staffId)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {isGoogleCalendarEnabled() && (
                <p className="text-xs text-white/40">
                  Se reservarán {fmtDuration(reservedMinutes || DEFAULT_SERVICE_MINUTES)} en Google Calendar.
                </p>
              )}

              {error && <p className="text-sm text-danger">{error}</p>}

              {conflicts.length > 0 && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm">
                  <p className="mb-1 flex items-center gap-1.5 font-medium text-amber-200">
                    <AlertTriangle className="h-4 w-4" /> Revisá la disponibilidad
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5 text-amber-100/80">
                    {conflicts.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="lg"
                      className="flex-1"
                      onClick={() => setConflicts([])}
                    >
                      Modificar
                    </Button>
                    <Button
                      size="lg"
                      className="flex-1"
                      loading={save.isPending}
                      onClick={() => attemptSchedule(true)}
                    >
                      Agendar igual
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Barra de acción fija (alcance táctil) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-950/90 px-4 py-3 backdrop-blur lg:px-8">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          {step === 1 ? (
            <>
              <p className="flex-1 text-sm text-white/50">
                {cats.length === 0
                  ? 'Elegí al menos una categoría'
                  : `${cats.length} categoría${cats.length > 1 ? 's' : ''} · ${dayLabel(date).dm} ${time}`}
              </p>
              <Button
                size="lg"
                disabled={!canContinue}
                onClick={() => setStep(2)}
              >
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="lg"
                onClick={() => setStep(1)}
              >
                <ArrowLeft className="h-4 w-4" /> Atrás
              </Button>
              {conflicts.length === 0 && (
                <>
                  <p className="hidden flex-1 text-sm text-white/50 sm:block">
                    {!hasClient
                      ? 'Elegí el cliente'
                      : !depositChosen
                        ? 'Elegí el abono'
                        : 'Todo listo para agendar'}
                  </p>
                  <Button
                    className="flex-1 sm:flex-none"
                    size="lg"
                    disabled={cats.length === 0 || !hasClient || !depositChosen}
                    loading={save.isPending}
                    onClick={() => attemptSchedule(false)}
                  >
                    <Check className="h-4 w-4" /> Agendar cita
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Punto/etiqueta de un paso del asistente. */
function StepDot({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
          active
            ? 'bg-gold text-ink-950'
            : done
              ? 'bg-gold/25 text-gold-100'
              : 'bg-white/10 text-white/50',
        )}
      >
        {done ? <Check className="h-4 w-4" /> : n}
      </span>
      <span
        className={cn(
          'text-sm',
          active ? 'font-medium text-white' : 'text-white/50',
        )}
      >
        {label}
      </span>
    </span>
  );
}

/** Selector de día y hora con react-big-calendar (semana/día, táctil). */
function SlotPicker({
  events,
  date,
  view,
  onView,
  onNavigate,
  onSelectSlot,
}: {
  events: {
    id: string;
    title: string;
    start: Date;
    end: Date;
    color: string;
    proposed: boolean;
  }[];
  date: Date;
  view: View;
  onView: (v: View) => void;
  onNavigate: (d: Date) => void;
  onSelectSlot: (start: Date) => void;
}) {
  const eventPropGetter = useCallback((event: object) => {
    const e = event as { color: string; proposed: boolean };
    return e.proposed
      ? {
          style: {
            backgroundColor: '#f4c752',
            color: '#1a1205',
            fontWeight: 700,
            border: '2px solid #f4c752',
          },
        }
      : {
          style: {
            backgroundColor: e.color || '#64748b',
            color: '#0b0c12',
            fontWeight: 600,
            opacity: 0.5,
          },
        };
  }, []);

  return (
    <div className="medusa-rbc" style={{ height: 540 }}>
      <Calendar
        localizer={rbcLocalizer}
        culture="es"
        events={events}
        date={date}
        view={view}
        onView={onView}
        onNavigate={onNavigate}
        views={['week', 'day']}
        step={30}
        timeslots={1}
        min={new Date(1970, 0, 1, 7, 0)}
        max={new Date(1970, 0, 1, 21, 0)}
        selectable
        longPressThreshold={80}
        onSelectSlot={(slot) => onSelectSlot(new Date(slot.start))}
        messages={rbcMessages}
        eventPropGetter={eventPropGetter}
        style={{ height: '100%' }}
      />
    </div>
  );
}

/* ═══════════════════════ Atención (cita existente) ═══════════════════════ */

interface ApptHead {
  id: string;
  status: AppointmentStatus;
  deposit_amount: number;
  start_at: string;
  end_at: string;
  customer_id: string | null;
  customer_name: string | null;
  created_at: string | null;
  created_by_name: string | null;
  google_calendar_id: string | null;
  google_calendar_event_id: string | null;
}

interface ItemRow {
  id: string;
  service_id: string | null;
  product_id: string | null;
  category: string | null;
  description: string;
  quantity: number;
  list_unit_price: number;
  discount_amount: number;
  final_unit_price: number;
  assigned_staff_id: string | null;
  staff_name: string | null;
  staff_color: string | null;
  duration: number | null;
}

function EditAppointment({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const services = useServices();
  const products = useProducts();
  const staff = useStaff();

  // Volver a la pantalla de origen (tareas, agenda, dashboard, clientes…). Si se
  // entró por link directo (sin historial) cae a la agenda.
  const goBack = () =>
    location.key !== 'default' ? navigate(-1) : navigate(ROUTES.calendar);

  const head = useQuery({
    queryKey: ['appointment-head', id],
    queryFn: () =>
      queryOne<ApptHead>(
        `SELECT a.id, a.status, a.deposit_amount, a.start_at, a.end_at,
                a.customer_id, a.created_at,
                a.google_calendar_id, a.google_calendar_event_id,
                c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS customer_name,
                u.full_name AS created_by_name
           FROM appointment a
           LEFT JOIN customer c ON c.id = a.customer_id
           LEFT JOIN app_user u ON u.id = a.created_by
          WHERE a.id = ?`,
        [id],
      ),
  });

  const items = useQuery({
    queryKey: ['appointment-items', id],
    queryFn: () =>
      query<ItemRow>(
        `SELECT ai.id, ai.service_id, ai.product_id, ai.category, ai.description, ai.quantity,
                ai.list_unit_price, ai.discount_amount, ai.final_unit_price,
                ai.assigned_staff_id,
                s.first_name || CASE WHEN s.last_name IS NOT NULL THEN ' ' || s.last_name ELSE '' END AS staff_name,
                s.color AS staff_color,
                sv.duration_minutes AS duration
           FROM appointment_item ai
           LEFT JOIN staff_member s ON s.id = ai.assigned_staff_id
           LEFT JOIN service sv ON sv.id = ai.service_id
          WHERE ai.appointment_id = ?
          ORDER BY (ai.product_id IS NOT NULL), ai.id`,
        [id],
      ),
  });

  // Seña realmente cobrada (pagos de la cita sin venta asociada todavía).
  const deposits = useQuery({
    queryKey: ['appointment-deposits', id],
    queryFn: () =>
      queryOne<{ paid: number }>(
        `SELECT COALESCE(SUM(amount), 0) AS paid FROM payment
          WHERE appointment_id = ? AND sale_id IS NULL AND status = 'confirmed'`,
        [id],
      ),
  });
  const depositPaid = deposits.data?.paid ?? 0;

  const serviceItems = (items.data ?? []).filter((i) => i.service_id);

  // Panel de alta activo debajo de la tabla de detalle.
  const [adding, setAdding] = useState<'service' | 'product' | null>(null);

  const orgId = useOrgId();
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  // Alta de servicio
  const [category, setCategory] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  // Alta de producto
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');

  const filteredServices = useMemo(
    () =>
      (services.data ?? []).filter((s) => !category || s.category === category),
    [services.data, category],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['appointment-items', id] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
  };

  const addService = useMutation({
    mutationFn: async ({ sid, stid }: { sid: string; stid: string | null }) => {
      const s = services.data?.find((x) => x.id === sid);
      if (!s) return;
      await execute(
        `INSERT INTO appointment_item
           (id, appointment_id, service_id, product_id, description, quantity,
            list_unit_price, discount_amount, final_unit_price, assigned_staff_id)
         VALUES (?, ?, ?, NULL, ?, 1, ?, 0, ?, ?)`,
        [genId(), id, s.id, s.name, s.base_price, s.base_price, stid || null],
      );
    },
    onSuccess: () => {
      setServiceId('');
      setStaffId('');
      setAdding(null);
      invalidate();
    },
  });

  // Reasignar estilista de un ítem. En atención NO se consulta disponibilidad;
  // sí se actualiza el evento de Google para que las comisiones/colores cuadren.
  const reassign = useMutation({
    mutationFn: async ({
      itemId,
      staffId: newStaff,
    }: {
      itemId: string;
      staffId: string | null;
    }) => {
      await execute(
        'UPDATE appointment_item SET assigned_staff_id = ? WHERE id = ?',
        [newStaff || null, itemId],
      );
      const h = head.data;
      if (h?.google_calendar_event_id && isGoogleCalendarEnabled()) {
        const nameOf = (sid: string | null) => {
          const s = staff.data?.find((x) => x.id === sid);
          return s ? fullName(s.first_name, s.last_name) : 'Sin asignar';
        };
        const updated = serviceItems.map((i) =>
          i.id === itemId ? { ...i, assigned_staff_id: newStaff } : i,
        );
        const desc = updated
          .map((i) => `• ${i.description} (${nameOf(i.assigned_staff_id)})`)
          .join('\n');
        const firstStaffId =
          updated.find((i) => i.assigned_staff_id)?.assigned_staff_id ?? null;
        const colorHex =
          staff.data?.find((s) => s.id === firstStaffId)?.color ?? null;
        try {
          await updateCalendarEvent(
            h.google_calendar_event_id,
            h.google_calendar_id,
            { description: desc, colorHex },
          );
        } catch {
          /* si Google falla, la reasignación local ya quedó guardada */
        }
      }
    },
    onSuccess: invalidate,
  });

  const addProduct = useMutation({
    mutationFn: async () => {
      const p = products.data?.find((x) => x.id === productId);
      if (!p) return;
      const q = Number(qty) || 1;
      await execute(
        `INSERT INTO appointment_item
           (id, appointment_id, service_id, product_id, description, quantity,
            list_unit_price, discount_amount, final_unit_price, assigned_staff_id)
         VALUES (?, ?, NULL, ?, ?, ?, ?, 0, ?, NULL)`,
        [genId(), id, p.id, p.name, q, p.base_price, p.base_price],
      );
    },
    onSuccess: () => {
      setProductId('');
      setQty('1');
      setAdding(null);
      invalidate();
    },
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) =>
      execute('DELETE FROM appointment_item WHERE id = ?', [itemId]),
    onSuccess: invalidate,
  });

  // Edición en línea de una celda del detalle (descripción, precios, cantidad).
  const updateItem = useMutation({
    mutationFn: ({
      itemId,
      patch,
    }: {
      itemId: string;
      patch: Record<string, number | string>;
    }) => {
      const cols = Object.keys(patch);
      const sets = cols.map((c) => `${c} = ?`).join(', ');
      const args = [...cols.map((c) => patch[c]), itemId];
      return execute(
        `UPDATE appointment_item SET ${sets} WHERE id = ?`,
        args,
      );
    },
    onSuccess: invalidate,
  });

  // Reglas de comisión vigentes: mismo cálculo que al confirmar la venta, para
  // mostrar el % del estilista por línea y el resumen de comisiones.
  const commissionRules = useQuery({
    queryKey: ['commission-rules', orgId],
    enabled: !!orgId,
    queryFn: () => loadCommissionRules(),
  });

  const setStatus = useMutation({
    mutationFn: (status: AppointmentStatus) =>
      execute('UPDATE appointment SET status = ?, updated_at = ? WHERE id = ?', [
        status,
        new Date().toISOString(),
        id,
      ]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointment-head', id] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
  });

  const all = items.data ?? [];
  // Vendibles: solo servicios/productos reales. Las filas de categoría (sin
  // servicio ni producto) son la intención de la reserva y no van a la venta
  // (violarían el CHECK de sale_item y sumarían líneas en $0).
  const sellableItems = all.filter((i) => i.service_id || i.product_id);
  const subtotal = all.reduce((a, i) => a + i.list_unit_price * i.quantity, 0);
  const discountTotal = all.reduce(
    (a, i) => a + i.discount_amount * i.quantity,
    0,
  );
  const total = all.reduce((a, i) => a + i.final_unit_price * i.quantity, 0);

  // Tiempo reservado: bloque más largo por estilista.
  const reservedMinutes = (() => {
    const m = new Map<string, number>();
    for (const i of serviceItems) {
      const k = i.assigned_staff_id || '__none';
      m.set(k, (m.get(k) ?? 0) + (i.duration ?? DEFAULT_SERVICE_MINUTES));
    }
    return m.size ? Math.max(...m.values()) : 0;
  })();

  if (head.isLoading) return null;
  if (!head.data) {
    return (
      <div className="space-y-6">
        <Header title="Cita" onBack={goBack} />
        <Card>
          <EmptyState icon={UserRound} title="Cita no encontrada" />
        </Card>
      </div>
    );
  }

  const meta = APPOINTMENT_STATUS[head.data.status];
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const fechaLarga = new Date(head.data.start_at).toLocaleDateString('es-EC', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // created_at viene de la base como "YYYY-MM-DD HH:MM:SS" en UTC (sin zona):
  // lo normalizo a ISO-UTC para que dateShort/timeShort lo pasen a hora local.
  const createdIso = head.data.created_at
    ? head.data.created_at.includes('T')
      ? head.data.created_at
      : `${head.data.created_at.replace(' ', 'T')}Z`
    : null;

  const rules = commissionRules.data;
  const itemCommission = (i: ItemRow) =>
    i.service_id && i.assigned_staff_id && rules
      ? commissionForItem(
          i.assigned_staff_id,
          i.service_id,
          i.final_unit_price * i.quantity,
          rules,
        )
      : null;

  const commissionByStaff = (() => {
    const m = new Map<
      string,
      { id: string; name: string; color: string | null; amount: number }
    >();
    for (const i of serviceItems) {
      const c = itemCommission(i);
      if (!c || !i.assigned_staff_id) continue;
      const prev = m.get(i.assigned_staff_id);
      if (prev) prev.amount += c.commission_amount;
      else
        m.set(i.assigned_staff_id, {
          id: i.assigned_staff_id,
          name: i.staff_name ?? 'Sin nombre',
          color: i.staff_color,
          amount: c.commission_amount,
        });
    }
    return [...m.values()];
  })();
  const totalCommission = commissionByStaff.reduce((a, s) => a + s.amount, 0);

  const totalServicios = serviceItems.reduce(
    (a, i) => a + i.final_unit_price * i.quantity,
    0,
  );
  const totalProductos = all
    .filter((i) => i.product_id)
    .reduce((a, i) => a + i.final_unit_price * i.quantity, 0);

  return (
    <div className="space-y-6">
      <Header
        title="Atención de cita"
        onBack={goBack}
        right={<Badge tone={meta.tone}>{meta.label}</Badge>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Cliente + datos de la cita */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-white/40">
                  Cliente
                </p>
                <h2 className="truncate text-xl font-semibold text-white">
                  {head.data.customer_name ?? 'Sin cliente'}
                </h2>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
                <div>
                  <span className="text-white/40">Fecha </span>
                  <span className="text-white capitalize">{fechaLarga}</span>
                </div>
                <div>
                  <span className="text-white/40">Hora </span>
                  <span className="text-white">
                    {timeShort(head.data.start_at)} – {timeShort(head.data.end_at)}
                  </span>
                </div>
                {reservedMinutes > 0 && (
                  <div>
                    <span className="text-white/40">Duración </span>
                    <span className="text-white">
                      {fmtDuration(reservedMinutes)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Datos del agendamiento del turno */}
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-white/10 pt-3 text-xs text-white/40">
              <span>
                Agendado el{' '}
                <span className="text-white/70">
                  {dateShort(createdIso)}
                  {createdIso ? ` · ${timeShort(createdIso)}` : ''}
                </span>
              </span>
              <span>
                Agendado por{' '}
                <span className="text-white/70">
                  {head.data.created_by_name ?? 'Sistema'}
                </span>
              </span>
            </div>
          </Card>

          {/* Detalle de venta */}
          <Card>
            <CardHeader
              title="Detalle de venta"
              subtitle="Clic en una celda para editar el precio, descuento o descripción"
            />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-white/40 [&>th]:pb-2 [&>th]:font-medium">
                    <th className="w-1" />
                    <th>Descripción</th>
                    <th>Estilista responsable</th>
                    <th className="text-right">% Estilista</th>
                    <th className="text-right">Cant.</th>
                    <th className="text-right">P. sugerido</th>
                    <th className="text-right">Descuento</th>
                    <th className="text-right">P. a cobrar</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {all.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-8 text-center text-white/40"
                      >
                        Sin ítems. Agregá un servicio o producto abajo.
                      </td>
                    </tr>
                  )}
                  {all.map((i) => {
                    const c = itemCommission(i);
                    return (
                      <tr key={i.id} className="align-middle">
                        <td className="py-1 pr-1">
                          <span
                            className="block h-8 w-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                i.service_id || i.category
                                  ? i.staff_color || '#64748b'
                                  : 'transparent',
                            }}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <InlineEdit
                            value={i.description}
                            align="left"
                            onCommit={(v) =>
                              v.trim() &&
                              updateItem.mutate({
                                itemId: i.id,
                                patch: { description: v.trim() },
                              })
                            }
                          />
                        </td>
                        <td className="py-1 pr-2">
                          {i.service_id || i.category ? (
                            <Select
                              value={i.assigned_staff_id ?? ''}
                              onChange={(e) =>
                                reassign.mutate({
                                  itemId: i.id,
                                  staffId: e.target.value || null,
                                })
                              }
                            >
                              <option value="">Sin asignar</option>
                              {(staff.data ?? []).map((s) => (
                                <option key={s.id} value={s.id}>
                                  {fullName(s.first_name, s.last_name)}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <span className="text-white/30">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-1 text-right text-white/70">
                          {c
                            ? c.commission_type === 'percentage'
                              ? `${num(c.commission_rate)}% · ${money(c.commission_amount)}`
                              : money(c.commission_amount)
                            : '—'}
                        </td>
                        <td className="py-1 text-right">
                          {i.product_id ? (
                            <InlineEdit
                              value={i.quantity}
                              type="number"
                              min={1}
                              onCommit={(v) =>
                                updateItem.mutate({
                                  itemId: i.id,
                                  patch: {
                                    quantity: Math.max(
                                      1,
                                      Math.floor(Number(v) || 1),
                                    ),
                                  },
                                })
                              }
                            />
                          ) : (
                            <span className="pr-1.5 text-white/50">1</span>
                          )}
                        </td>
                        <td className="py-1 pr-1.5 text-right text-white/50">
                          {money(i.list_unit_price)}
                        </td>
                        <td className="py-1 text-right">
                          <InlineEdit
                            value={i.discount_amount}
                            type="number"
                            display={money(i.discount_amount)}
                            onCommit={(v) => {
                              // Descuento nunca negativo; el neto se recalcula.
                              const disc = Math.max(0, round2(Number(v) || 0));
                              updateItem.mutate({
                                itemId: i.id,
                                patch: {
                                  discount_amount: disc,
                                  final_unit_price: round2(
                                    i.list_unit_price - disc,
                                  ),
                                },
                              });
                            }}
                          />
                        </td>
                        <td className="py-1 text-right">
                          <InlineEdit
                            value={i.final_unit_price}
                            type="number"
                            display={money(i.final_unit_price)}
                            onCommit={(v) => {
                              // Si sube por encima del sugerido es un incremento:
                              // el descuento queda en 0 (nunca negativo).
                              const fin = round2(Number(v) || 0);
                              updateItem.mutate({
                                itemId: i.id,
                                patch: {
                                  final_unit_price: fin,
                                  discount_amount: Math.max(
                                    0,
                                    round2(i.list_unit_price - fin),
                                  ),
                                },
                              });
                            }}
                          />
                        </td>
                        <td className="py-1 pl-1 text-right">
                          <button
                            onClick={() => removeItem.mutate(i.id)}
                            className="text-white/40 hover:text-danger"
                            title="Eliminar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {all.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-white/10 text-sm font-semibold [&>td]:pt-3">
                      <td />
                      <td className="text-white/50" colSpan={2}>
                        Totales
                      </td>
                      <td className="whitespace-nowrap text-right text-white/70">
                        {money(totalCommission)}
                      </td>
                      <td colSpan={3} />
                      <td className="kpi-gold text-right">{money(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Agregar ítems */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={adding === 'service' ? 'gold' : 'outline'}
                onClick={() =>
                  setAdding(adding === 'service' ? null : 'service')
                }
              >
                <Scissors className="h-4 w-4" /> Agregar servicio
              </Button>
              <Button
                size="sm"
                variant={adding === 'product' ? 'gold' : 'outline'}
                onClick={() =>
                  setAdding(adding === 'product' ? null : 'product')
                }
              >
                <Package className="h-4 w-4" /> Agregar producto
              </Button>
            </div>

            {adding === 'service' && (
              <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-3">
                <Select
                  label="Categoría"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setServiceId('');
                  }}
                >
                  <option value="">Todas</option>
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Servicio"
                  value={serviceId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v && staffId)
                      addService.mutate({ sid: v, stid: staffId });
                    else setServiceId(v);
                  }}
                >
                  <option value="">Seleccionar…</option>
                  {filteredServices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {money(s.base_price)}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Estilista"
                  value={staffId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v && serviceId)
                      addService.mutate({ sid: serviceId, stid: v });
                    else setStaffId(v);
                  }}
                >
                  <option value="">Sin asignar</option>
                  {staff.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fullName(s.first_name, s.last_name)}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {adding === 'product' && (
              <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <Select
                    label="Producto"
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                  >
                    <option value="">Seleccionar…</option>
                    {products.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {money(p.base_price)}
                      </option>
                    ))}
                  </Select>
                </div>
                <Input
                  label="Cant."
                  type="number"
                  min="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
                <Button
                  className="self-end"
                  onClick={() => addProduct.mutate()}
                  disabled={!productId || addProduct.isPending}
                >
                  <Plus className="h-4 w-4" /> Agregar
                </Button>
              </div>
            )}
          </Card>
        </div>

        {/* Resumen */}
        <div className="lg:col-span-1">
          <Card gold className="sticky top-4">
            <CardHeader title="Resumen" />
            <div className="space-y-4">
              <Select
                label="Estado"
                value={head.data.status}
                disabled={head.data.status === 'attended'}
                onChange={(e) => {
                  const next = e.target.value as AppointmentStatus;
                  if (next === head.data!.status) return;
                  // "Atendido" no se marca directo: se confirma la venta y el cobro.
                  if (next === 'attended') {
                    setConfirmOpen(true);
                    return;
                  }
                  setStatus.mutate(next);
                }}
              >
                {(Object.keys(APPOINTMENT_STATUS) as AppointmentStatus[]).map(
                  (st) => (
                    <option key={st} value={st}>
                      {APPOINTMENT_STATUS[st].label}
                    </option>
                  ),
                )}
              </Select>
              {head.data.status === 'attended' && (
                <div className="-mt-2 space-y-2">
                  <p className="text-xs text-white/40">
                    Cita atendida: ya tiene venta y cobro registrados.
                  </p>
                  <button
                    onClick={() => setVoidOpen(true)}
                    className="text-xs font-medium text-danger hover:underline"
                  >
                    Anular venta y cobro
                  </button>
                </div>
              )}

              {/* Totales */}
              <div className="space-y-2 border-t border-white/10 pt-4 text-sm">
                <Row label="Subtotal" value={money(subtotal)} />
                <Row label="Total servicios" value={money(totalServicios)} />
                <Row label="Total productos" value={money(totalProductos)} />
                <Row label="Descuentos" value={`−${money(discountTotal)}`} />
                <div className="flex items-center justify-between border-t border-white/10 pt-2">
                  <span className="font-medium text-white/70">Total</span>
                  <span
                    className={cn(
                      'font-semibold',
                      depositPaid > 0 ? 'text-white' : 'kpi-gold text-2xl',
                    )}
                  >
                    {money(total)}
                  </span>
                </div>
                {depositPaid > 0 && (
                  <>
                    <Row
                      label="Abono ya pagado"
                      value={`−${money(depositPaid)}`}
                    />
                    <div className="flex items-center justify-between border-t border-white/10 pt-2">
                      <span className="font-medium text-white/70">
                        Saldo a cobrar
                      </span>
                      <span className="kpi-gold text-2xl">
                        {money(Math.max(0, total - depositPaid))}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Comisiones estilistas */}
              {commissionByStaff.length > 0 && (
                <div className="space-y-2 border-t border-white/10 pt-4 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/40">
                    Comisiones estilistas
                  </p>
                  {commissionByStaff.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2 text-white/70">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: s.color || '#64748b' }}
                        />
                        {s.name}
                      </span>
                      <span className="text-white">{money(s.amount)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-white/10 pt-2">
                    <span className="font-medium text-white/70">
                      Total comisiones
                    </span>
                    <span className="font-semibold text-white">
                      {money(totalCommission)}
                    </span>
                  </div>
                </div>
              )}

              {head.data.status !== 'attended' && (
                <Button
                  className="w-full"
                  disabled={sellableItems.length === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Check className="h-4 w-4" /> Confirmar venta
                </Button>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate(ROUTES.calendar)}
              >
                Volver
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {confirmOpen && head.data && (
        <ConfirmSaleModal
          appointmentId={id}
          orgId={orgId}
          branchId={branchId}
          userId={userId}
          customerId={head.data.customer_id}
          customerName={head.data.customer_name}
          serviceDate={head.data.start_at}
          items={sellableItems}
          subtotal={subtotal}
          discountTotal={discountTotal}
          total={total}
          depositPaid={depositPaid}
          onClose={() => setConfirmOpen(false)}
          onDone={() => {
            setConfirmOpen(false);
            navigate(ROUTES.calendar);
          }}
        />
      )}

      {voidOpen && (
        <VoidSaleModal
          appointmentId={id}
          branchId={branchId}
          userId={userId}
          customerName={head.data.customer_name}
          onClose={() => setVoidOpen(false)}
          onDone={() => {
            setVoidOpen(false);
            qc.invalidateQueries({ queryKey: ['appointment-head', id] });
            qc.invalidateQueries({ queryKey: ['appointments'] });
          }}
        />
      )}
    </div>
  );
}

/**
 * Anula la venta y el cobro de una cita atendida, sin descuadrar:
 *  - la venta y sus pagos pasan a "voided" (dejan de contar en ingresos/saldos);
 *  - por cada cobro en efectivo se registra un movimiento de salida en la caja
 *    abierta, para revertir el efectivo que había entrado;
 *  - la cita vuelve a "Atendiendo" para poder corregirla y re-confirmarla.
 */
function VoidSaleModal({
  appointmentId,
  branchId,
  userId,
  customerName,
  onClose,
  onDone,
}: {
  appointmentId: string;
  branchId: string;
  userId: string | null;
  customerName: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState('');

  // Venta de la cita + sus pagos (con tipo de método, para saber cuál es efectivo).
  const data = useQuery({
    queryKey: ['appointment-sale', appointmentId],
    queryFn: async () => {
      const sale = await queryOne<{ id: string; total: number }>(
        `SELECT id, total FROM sale
          WHERE appointment_id = ? AND status <> 'voided'
          ORDER BY created_at DESC LIMIT 1`,
        [appointmentId],
      );
      if (!sale) return { sale: null, payments: [] as PaymentLite[] };
      const payments = await query<PaymentLite>(
        `SELECT p.id, p.amount, p.appointment_id, pm.method_type
           FROM payment p
           JOIN payment_method pm ON pm.id = p.payment_method_id
          WHERE p.sale_id = ? AND p.status = 'confirmed'`,
        [sale.id],
      );
      return { sale, payments };
    },
  });

  // Caja abierta (para revertir efectivo).
  const cash = useQuery({
    queryKey: ['open-cash', branchId],
    enabled: !!branchId,
    queryFn: () =>
      queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'open'
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      ),
  });
  const sessionId = cash.data?.id ?? null;

  const sale = data.data?.sale ?? null;
  const payments = data.data?.payments ?? [];
  // La seña (pago atado a la cita) NO se anula: no es reembolsable. Se desvincula
  // de la venta y vuelve a quedar como abono de la cita. Solo se revierte el saldo.
  const depositTotal = payments
    .filter((p) => p.appointment_id)
    .reduce((a, p) => a + p.amount, 0);
  const cashTotal = payments
    .filter((p) => p.method_type === 'cash' && !p.appointment_id)
    .reduce((a, p) => a + p.amount, 0);

  const voidSale = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      const stmts: { sql: string; args: (string | number | null)[] }[] = [];

      if (sale) {
        stmts.push({
          sql: `UPDATE sale SET status = 'voided', updated_at = ? WHERE id = ?`,
          args: [now, sale.id],
        });
        // Anula el saldo cobrado; la seña se desvincula (sigue pagada).
        stmts.push({
          sql: `UPDATE payment SET status = 'voided'
                  WHERE sale_id = ? AND appointment_id IS NULL`,
          args: [sale.id],
        });
        stmts.push({
          sql: `UPDATE payment SET sale_id = NULL
                  WHERE sale_id = ? AND appointment_id IS NOT NULL`,
          args: [sale.id],
        });
        // Revertir el efectivo del saldo que había entrado a caja.
        if (cashTotal > 0 && sessionId) {
          stmts.push({
            sql: `INSERT INTO cash_movement
                    (id, cash_session_id, branch_id, movement_type, direction, amount,
                     movement_at, sale_id, description, created_by)
                  VALUES (?, ?, ?, 'adjustment', 'out', ?, ?, ?, ?, ?)`,
            args: [
              genId(),
              sessionId,
              branchId,
              cashTotal,
              now,
              sale.id,
              `Anulación venta ${customerName ?? ''}`.trim(),
              userId,
            ],
          });
        }
      }

      // La cita vuelve a "Atendiendo" para corregirla y re-confirmarla.
      stmts.push({
        sql: `UPDATE appointment SET status = 'confirmed', updated_at = ? WHERE id = ?`,
        args: [now, appointmentId],
      });

      await batch(stmts);
    },
    onSuccess: onDone,
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'No se pudo anular la venta.'),
  });

  const blocked = cashTotal > 0 && !sessionId;

  return (
    <Modal open onClose={onClose} title="Anular venta y cobro">
      <div className="space-y-4">
        <p className="text-sm text-white/70">
          Se anulará la venta y sus cobros. La cita volverá a «Atendiendo» para
          corregirla y volver a cobrar.
        </p>

        {data.isLoading ? (
          <p className="text-sm text-white/40">Cargando…</p>
        ) : !sale ? (
          <p className="text-sm text-white/40">
            No se encontró una venta activa para esta cita. Igual se devolverá la
            cita a «Atendiendo».
          </p>
        ) : (
          <div className="rounded-xl bg-white/5 p-3 text-sm">
            <div className="flex justify-between text-white/60">
              <span>Total a anular</span>
              <span className="kpi-gold">{money(sale.total)}</span>
            </div>
            {cashTotal > 0 && (
              <p className="mt-1 text-xs text-white/40">
                Se revertirán {money(cashTotal)} de la caja en efectivo.
              </p>
            )}
            {depositTotal > 0 && (
              <p className="mt-1 text-xs text-white/40">
                La seña de {money(depositTotal)} no se reembolsa: queda como abono
                de la cita.
              </p>
            )}
          </div>
        )}

        {blocked && (
          <p className="flex items-center gap-1.5 text-xs text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5" /> Hay cobro en efectivo pero no
            hay caja abierta. Abrí la caja para revertir el efectivo antes de
            anular.
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            variant="danger"
            disabled={voidSale.isPending || blocked || data.isLoading}
            loading={voidSale.isPending}
            onClick={() => {
              setError('');
              voidSale.mutate();
            }}
          >
            Anular
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface PaymentLite {
  id: string;
  amount: number;
  appointment_id: string | null;
  method_type: string;
}

/**
 * Confirma la venta de la cita: crea la venta (con comisiones al colaborador
 * asignado, % por defecto) y registra el pago con su forma de pago. El efectivo
 * entra a la caja abierta; transferencia/tarjeta no tocan la caja física.
 * Al confirmar, la cita queda "atendida".
 */
function ConfirmSaleModal({
  appointmentId,
  orgId,
  branchId,
  userId,
  customerId,
  customerName,
  serviceDate,
  items,
  subtotal,
  discountTotal,
  total,
  depositPaid,
  onClose,
  onDone,
}: {
  appointmentId: string;
  orgId: string;
  branchId: string;
  userId: string | null;
  customerId: string | null;
  customerName: string | null;
  serviceDate: string;
  items: ItemRow[];
  subtotal: number;
  discountTotal: number;
  total: number;
  depositPaid: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  // Saldo a cobrar = total − seña ya pagada.
  // El monto a cobrar es el saldo (total − seña) y no es editable: se cobra
  // exactamente lo que resta de la venta.
  const balance = Math.max(0, total - depositPaid);
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  const methods = useQuery({
    queryKey: ['payment-methods', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });

  // Caja abierta de la sucursal (para movimientos en efectivo).
  const cash = useQuery({
    queryKey: ['open-cash', branchId],
    enabled: !!branchId,
    queryFn: () =>
      queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'open'
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      ),
  });
  const sessionId = cash.data?.id ?? null;

  const method = methods.data?.find((m) => m.id === methodId);
  const isCash = method?.method_type === 'cash';

  // ¿La cita es de un día anterior? → venta retroactiva.
  const now = new Date();
  const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(now.getDate()).padStart(2, '0')}`;
  const serviceDay = serviceDate.slice(0, 10);
  const isRetroactive = serviceDay < todayYmd;

  const confirm = useMutation({
    mutationFn: async () => {
      // Guarda anti-doble-venta: si la cita ya fue atendida, no se vuelve a
      // vender. Se relee el estado real en DB por si otra pestaña la cerró.
      const current = await queryOne<{ status: AppointmentStatus }>(
        'SELECT status FROM appointment WHERE id = ?',
        [appointmentId],
      );
      if (current?.status === 'attended') {
        throw new Error('Esta cita ya fue atendida y cobrada.');
      }

      // Comisiones vigentes por colaborador+servicio (config o % por defecto).
      const rules = await loadCommissionRules();

      // Ítems → líneas de venta con comisión del colaborador asignado.
      const draftItems: DraftSaleItem[] = items.map((it) => {
        const commissions: DraftCommission[] = [];
        if (it.service_id && it.assigned_staff_id) {
          const basis = it.final_unit_price * it.quantity;
          const c = commissionForItem(
            it.assigned_staff_id,
            it.service_id,
            basis,
            rules,
          );
          commissions.push({
            tempId: genId(),
            staff_member_id: it.assigned_staff_id,
            participation_role: 'primary',
            commission_type: c.commission_type,
            commission_rate: c.commission_rate,
            commission_amount: c.commission_amount,
            reduces_primary_amount: false,
          });
        }
        return {
          tempId: genId(),
          service_id: it.service_id,
          product_id: it.product_id,
          description: it.description,
          quantity: it.quantity,
          list_unit_price: it.list_unit_price,
          discount_amount: it.discount_amount,
          final_unit_price: it.final_unit_price,
          commissions,
        };
      });

      const saleId = await createSale({
        orgId,
        branchId,
        userId,
        customerId,
        appointmentId,
        requiresInvoice: false,
        items: draftItems,
        subtotal,
        discountTotal,
        total,
        // Venta/comisiones con la fecha real del servicio (retroactivo si aplica).
        soldAt: serviceDate,
      });

      const now = new Date().toISOString();
      const pay = balance;
      const stmts: { sql: string; args: (string | number | null)[] }[] = [];

      // La seña ya cobrada se atribuye a esta venta (deja de ser "otro ingreso").
      stmts.push({
        sql: `UPDATE payment SET sale_id = ?
                WHERE appointment_id = ? AND sale_id IS NULL AND status = 'confirmed'`,
        args: [saleId, appointmentId],
      });

      // Cobro del saldo (solo si queda algo por cobrar tras la seña).
      if (pay > 0) {
        const paymentId = genId();
        stmts.push({
          sql: `INSERT INTO payment
                  (id, organization_id, branch_id, sale_id, payment_method_id, paid_at,
                   amount, status, reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            paymentId,
            orgId,
            branchId,
            saleId,
            methodId,
            now,
            pay,
            reference || null,
          ],
        });

        // Solo el efectivo ingresa a la caja física.
        if (isCash && sessionId) {
          stmts.push({
            sql: `INSERT INTO cash_movement
                    (id, cash_session_id, branch_id, movement_type, direction, amount,
                     movement_at, sale_id, payment_id, description, created_by)
                  VALUES (?, ?, ?, 'sale', 'in', ?, ?, ?, ?, ?, ?)`,
            args: [
              genId(),
              sessionId,
              branchId,
              pay,
              now,
              saleId,
              paymentId,
              `Venta cita ${customerName ?? ''}`.trim(),
              userId,
            ],
          });
        }
      }

      // La cita queda atendida.
      stmts.push({
        sql: `UPDATE appointment SET status = 'attended', updated_at = ? WHERE id = ?`,
        args: [now, appointmentId],
      });

      await batch(stmts);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointment-head', appointmentId] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      onDone();
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'No se pudo confirmar la venta.'),
  });

  const canConfirm =
    items.length > 0 &&
    !confirm.isPending &&
    (balance === 0 || (!!methodId && balance > 0));

  return (
    <Modal open onClose={onClose} title="Confirmar venta">
      <div className="space-y-4">
        <div className="space-y-1 rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>{customerName ?? 'Sin cliente'}</span>
            <span>Total {money(total)}</span>
          </div>
          {depositPaid > 0 && (
            <div className="flex justify-between text-white/60">
              <span>Seña ya cobrada</span>
              <span className="text-emerald-300">−{money(depositPaid)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-white/10 pt-1 font-medium text-white">
            <span>Saldo a cobrar</span>
            <span className="kpi-gold">{money(balance)}</span>
          </div>
        </div>

        <Select
          label="Forma de pago"
          value={methodId}
          onChange={(e) => setMethodId(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          {methods.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>

        <Input
          label="Referencia (opcional)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Nº transferencia, voucher…"
        />

        {isRetroactive && (
          <p className="flex items-center gap-1.5 text-xs text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5" /> Venta retroactiva: el
            servicio se registra con fecha {dateShort(serviceDay)}; el cobro entra
            a la caja de hoy.
          </p>
        )}
        {isCash && !sessionId && (
          <p className="flex items-center gap-1.5 text-xs text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5" /> No hay caja abierta: el pago
            se registra pero no entra al efectivo de caja.
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}

        <Button
          className="w-full"
          disabled={!canConfirm}
          loading={confirm.isPending}
          onClick={() => {
            setError('');
            confirm.mutate();
          }}
        >
          <Check className="h-4 w-4" /> Confirmar venta
        </Button>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════ Compartidos ═══════════════════════════ */

function Header({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
      </div>
      {right}
    </div>
  );
}

/** Celda con edición en línea: muestra un valor y, al hacer clic, un input. */
function InlineEdit({
  value,
  display,
  type = 'text',
  align = 'right',
  min,
  onCommit,
}: {
  value: string | number;
  display?: string;
  type?: 'text' | 'number';
  align?: 'left' | 'right';
  min?: number;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        title="Clic para editar"
        className={cn(
          'w-full rounded-md px-1.5 py-1 hover:bg-white/10',
          align === 'right' ? 'text-right' : 'text-left',
        )}
      >
        {display ?? String(value)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type={type}
      step={type === 'number' ? '0.01' : undefined}
      min={min}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== String(value)) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') setEditing(false);
      }}
      className={cn(
        'w-full rounded-md border border-gold/50 bg-ink-800 px-1.5 py-1 text-white outline-none',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    />
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/50">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
