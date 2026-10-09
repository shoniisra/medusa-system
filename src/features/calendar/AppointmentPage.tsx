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
  Check,
  UserRound,
  AlertTriangle,
  Pencil,
  Wallet,
  X,
} from 'lucide-react';
import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './agenda-calendar.css';
import { query, queryOne, batch, execute, type Stmt } from '@/lib/db';
import {
  genId,
  money,
  customerName,
  fullName,
  toLocalNaive,
  dateShort,
  timeShort,
} from '@/lib/format';
import {
  invalidateAppointments,
  invalidateCustomers,
  invalidateFinance,
  invalidateSales,
} from '@/lib/queryClient';
import {
  CustomerFields,
  type CustomerDraft,
} from '@/features/clients/CustomerFields';
import {
  PaymentTargetFields,
  useOpenCashSession,
  usePaymentTarget,
} from '@/features/cashflow/accounts';
import { useBranchCashSession } from '@/features/cashflow/cashSessionActions';
import { SaleDetailModal } from '@/features/sales/SaleDetailModal';
import { searchCustomers } from '@/features/clients/customerSearch';
import { useOrgId, useBranchId, useSession } from '@/store/session';
import { useCustomers, useServices, useProducts, useStaff } from '@/features/pos/useCatalog';
import {
  DEFAULT_SERVICE_MINUTES,
  minutesForCategory,
  toMinutes,
  fromMinutes,
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
  eventIdForAppointment,
} from '@/lib/googleCalendar';
import {
  Button,
  Card,
  CardHeader,
  DateInput,
  Input,
  Select,
  EmptyState,
  Badge,
  Modal,
  useToast,
  PageHeader,
  DetailRow,
} from '@/components/ui';
import {
  findCustomerByPhone,
  phoneOwner,
} from '@/features/clients/customerLookup';
import { DuplicatePhoneNotice } from '@/features/clients/DuplicatePhoneNotice';
import { CustomerPicker } from '@/features/clients/CustomerPicker';
import { MergeClientsModal } from '@/features/clients/MergeClientsModal';
import {
  fillCustomerGaps,
  gapFillSummary,
  renamedName,
  type CustomerPatch,
} from '@/features/clients/mergeCustomers';
import { validatePhone } from '@/lib/phone';
import { normalizeEmail, validateEmail } from '@/lib/email';
import {
  createSale,
  loadCommissionRules,
  commissionForItem,
} from '@/features/pos/createSale';
import {
  SaleItemsEditor,
  commissionByStaff,
} from '@/features/pos/SaleItemsEditor';
import { ymd } from '@/lib/date';
import { isNoCharge, stripNoCharge } from './appointmentBoard';
import { PaymentsHistoryCard, type PaymentRow } from './PaymentsHistoryCard';
import {
  CustomerHistoryCard,
  loadCustomerHistory,
} from './CustomerHistoryCard';
import type {
  AppointmentStatus,
  BankAccount,
  Customer,
  DraftCommission,
  DraftSaleItem,
  PaymentMethod,
  Product,
} from '@/types';
import { customerNameSql } from '@/features/clients/customerNameSql';

export function AppointmentPage() {
  const { id } = useParams();
  return id ? <EditAppointment id={id} /> : <NewAppointment />;
}

/** Minutos → "1 h 30 min" / "45 min". */
/** Aviso flotante para cada estado nuevo de la cita en su ficha. */
const APPT_STATUS_TOAST: Partial<Record<AppointmentStatus, string>> = {
  reserved: 'Cita reservada',
  confirmed: 'Cita en atención',
  attended: 'Cita atendida',
  cancelled: 'Cita cancelada',
  no_show: 'Marcada como no asistió',
};

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

/**
 * Hora libre a mano. La rejilla y el calendario avanzan de a bloques; esto
 * permite cualquier minuto en múltiplos de 5 (14:45, 17:15…).
 */
function TimeField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/60',
        className,
      )}
    >
      Otra hora
      <input
        type="time"
        value={value}
        step={300}
        onChange={(e) => {
          if (!e.target.value) return;
          onChange(e.target.value);
        }}
        className="rounded-lg border border-white/10 bg-ink-800/60 px-2.5 py-2 text-white"
      />
    </label>
  );
}

/* ═══════════════════════════ Nueva cita ═══════════════════════════ */

/** Categoría de servicio elegida al agendar, con su estilista (opcional). */
interface DraftCat {
  category: string;
  staffId: string;
}

function NewAppointment() {
  const navigate = useNavigate();
  const toast = useToast();
  const orgId = useOrgId();
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  const [params] = useSearchParams();

  const customers = useCustomers();
  const staff = useStaff();

  // Paso del asistente: 1) qué · 2) cuándo · 3) cliente y abono.
  const [step, setStep] = useState<1 | 2 | 3>(1);

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
  /**
   * ¿La hora la eligió el usuario? Mientras no la toque, el asistente puede
   * proponer el primer hueco libre. Apenas la elige, su decisión manda: ir y
   * volver entre pasos (o cambiar categorías) ya no se la pisa.
   */
  const timePicked = useRef(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const pickTime = useCallback((v: string) => {
    timePicked.current = true;
    setTime(v);
    setConflicts([]);
  }, []);
  const [deposit, setDeposit] = useState('0');
  const [customDeposit, setCustomDeposit] = useState(false);
  // El abono debe elegirse explícitamente (5/10/20/Otro) antes de agendar.
  const [depositChosen, setDepositChosen] = useState(false);
  /** Nº de voucher / referencia de la transferencia de la seña (opcional). */
  const [depositRef, setDepositRef] = useState('');
  /** Observaciones de la cita (opcional): pedido del cliente, avisos. */
  const [notes, setNotes] = useState('');

  // Categorías elegidas (con estilista opcional por categoría).
  const [cats, setCats] = useState<DraftCat[]>([]);
  const [error, setError] = useState('');

  // Vista del calendario: en móvil arranca en "Día"; en escritorio en "Semana".
  const [calView, setCalView] = useState<View>(() =>
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 768px)').matches
      ? 'day'
      : 'week',
  );

  const hasClient = !!customerId || newClient;
  // Un cliente nuevo sin nombre escrito no alcanza para agendar: se guardaba la
  // ficha con first_name vacío y el evento de Google quedaba sin nombre en el
  // título (y el sync lo devolvía como cliente "(abono 00)").
  const clientReady = !!customerId || (newClient && !!firstName.trim());
  const selectedCustomer = customers.data?.find((c) => c.id === customerId);

  // ── Cliente: buscador con foco automático y creación al vuelo ──
  useEffect(() => {
    if (step === 3 && !hasClient) searchRef.current?.focus();
  }, [step, hasClient]);

  const clientMatches = useMemo(
    () => searchCustomers(customers.data ?? [], clientSearch),
    [customers.data, clientSearch],
  );

  // Dueño del número que se está escribiendo para el cliente nuevo. Se busca
  // entre los contactos ya cargados, así el aviso aparece mientras se tipea y no
  // recién al guardar: el teléfono es único y casi siempre lo que corresponde es
  // usar la ficha que ya existe.
  const phoneTaken = useMemo(
    () => (newClient ? phoneOwner(customers.data ?? [], phone) : null),
    [newClient, customers.data, phone],
  );

  function pickExisting(c: { id: string }) {
    setCustomerId(c.id);
    setNewClient(false);
    setClientSearch('');
  }

  /** Lo escrito en el alta rápida, en la forma en que se guarda. */
  const typedPatch: CustomerPatch = {
    first_name: firstName.trim(),
    last_name: lastName.trim() || null,
    phone: phone.trim() || null,
  };

  /** Nombre que quedaría en la ficha del número repetido si se la usa. */
  const renameTo = phoneTaken ? renamedName(phoneTaken, typedPatch) : null;

  /**
   * El número ya tiene ficha: en vez de hacer borrar y buscar a mano, se usa esa
   * y se le pone el nombre que se acaba de escribir (el viejo baja a alias, ver
   * `fillCustomerGaps`). La fila se relee: `phoneTaken` sale del cache de
   * clientes y podría tener minutos.
   */
  const useExistingClient = useMutation({
    mutationFn: async () => {
      if (!phoneTaken) return null;
      const row = await queryOne<Customer>(
        'SELECT * FROM customer WHERE id = ?',
        [phoneTaken.id],
      );
      if (!row) throw new Error('Esa ficha ya no existe. Recargá la pantalla.');
      const gap = fillCustomerGaps(row, typedPatch);
      if (gap) await batch([gap.stmt]);
      return gap;
    },
    onSuccess: (gap) => {
      invalidateCustomers(qc, orgId);
      pickExisting(phoneTaken!);
      toast.success(
        `Ficha de ${gap?.renamedFrom ? renameTo : customerName(phoneTaken!)}`,
        gapFillSummary(gap),
      );
    },
    onError: (e: Error) =>
      toast.error('No se pudo usar ese contacto', e.message),
  });

  function startNewClient() {
    const parts = clientSearch.trim().split(/\s+/).filter(Boolean);
    setFirstName(parts[0] ?? '');
    setLastName(parts.slice(1).join(' '));
    setNewClient(true);
    setCustomerId('');
    setTimeout(() => phoneRef.current?.focus(), 0);
  }

  /**
   * Cliente nuevo: se guarda apenas se confirma, no al agendar. Así el registro
   * queda en la lista aunque después se abandone el asistente sin crear la cita.
   */
  const createClient = useMutation({
    mutationFn: async () => {
      const fn = firstName.trim();
      if (!fn) throw new Error('El nombre del cliente es obligatorio.');
      const ph = phone.trim();
      const phoneError = validatePhone(ph);
      if (phoneError) throw new Error(phoneError);
      if (ph) {
        const hit = await findCustomerByPhone(orgId, ph);
        if (hit) {
          throw new Error(
            `Ese número ya es de ${customerName(hit)}. Usá ese contacto en vez de crear uno nuevo.`,
          );
        }
      }
      const id = genId();
      await execute(
        `INSERT INTO customer (id, organization_id, first_name, last_name, phone)
         VALUES (?, ?, ?, ?, ?)`,
        [id, orgId, fn, lastName.trim() || null, ph || null],
      );
      const now = new Date().toISOString();
      const row: Customer = {
        id,
        organization_id: orgId,
        first_name: fn,
        last_name: lastName.trim() || null,
        nickname: null,
        imported_name: null,
        phone: ph || null,
        email: null,
        birth_date: null,
        tax_id: null,
        notes: null,
        allergies: null,
        hair_notes: null,
        preferred_staff_id: null,
        first_visit_at: null,
        last_visit_at: null,
        active: 1,
        created_at: now,
        updated_at: now,
      };
      return row;
    },
    onSuccess: (row) => {
      // Disponible al instante en el buscador y en el resumen, sin esperar
      // al refetch de la lista.
      qc.setQueryData<Customer[]>(['customers', orgId], (old) =>
        old ? [...old, row] : old,
      );
      invalidateCustomers(qc, orgId);
      setNewClient(false);
      setCustomerId(row.id);
      setClientSearch('');
      setError('');
      toast.success('Cliente creado', customerName(row));
    },
    onError: (e) => {
      const msg =
        e instanceof Error ? e.message : 'No se pudo crear el cliente.';
      setError(msg);
      toast.error('No se pudo crear el cliente', msg);
    },
  });

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
  const openCash = useOpenCashSession(branchId);
  const todayCash = useBranchCashSession(branchId);
  const hasOpenCashToday = !!todayCash.session;
  const cashMethod = payMethods.data?.find((m) => m.method_type === 'cash');
  const transferMethod = payMethods.data?.find((m) => m.method_type === 'transfer');
  const firstBankId = banks.data?.[0]?.id ?? '';
  const effectiveDest = depositDest || firstBankId || 'cash';
  const depositIsCash = effectiveDest === 'cash';

  // Tiempo reservado: al agendar todavía no hay servicio exacto, así que vale
  // el tiempo típico de cada categoría, apilando las del mismo estilista (las
  // de distinto estilista van en paralelo).
  const staffBlocks = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cats) {
      const k = c.staffId || '__none';
      m.set(k, (m.get(k) ?? 0) + minutesForCategory(c.category));
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
  const weekFrom = ymd(weekStart);
  const weekTo = ymd(new Date(weekStart.getTime() + 6 * 86400000));

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
        google_color_hex: string | null;
        cust: string | null;
      }>(
        `SELECT a.id, a.start_at, a.end_at,
                ai.assigned_staff_id AS staff_id,
                s.color AS staff_color,
                a.google_color_hex,
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
      // Sin estilista asignada, vale el color que tiene el evento en Google.
      color: r.staff_color || r.google_color_hex || '#64748b',
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
      if (newClient) {
        const phoneError = validatePhone(newPhone);
        if (phoneError) throw new Error(phoneError);
      }
      if (newClient && newPhone) {
        const hit = await findCustomerByPhone(orgId, newPhone);
        if (hit) {
          throw new Error(
            `Ese número ya es de ${customerName(hit)}. Usá ese contacto en vez de crear uno nuevo.`,
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
        : selectedCustomer
          ? customerName(selectedCustomer)
          : '';

      const apptId = genId();

      // Google Calendar: se sincroniza siempre que esté configurado. La cita se
      // guarda igual si Google falla; el evento es un extra.
      //
      // El evento se crea DESPUÉS de guardar la cita, con un id derivado del id
      // de la cita (eventIdForAppointment). Antes era al revés y eso duplicaba
      // citas: el trigger de Apps Script dispara en segundos, así que el sync
      // podía llegar con el evento cuando la cita todavía no estaba en la base,
      // no encontraba nada por google_calendar_event_id y creaba una cita
      // paralela con el cliente adivinado del título.
      let calendarId: string | null = null;
      let googleEventId: string | null = null;
      if (isGoogleCalendarEnabled()) {
        const branchRow = await queryOne<{ google_calendar_id: string | null }>(
          'SELECT google_calendar_id FROM branch WHERE id = ?',
          [branchId],
        );
        calendarId = branchRow?.google_calendar_id?.trim() || null;
        if (!calendarId) {
          // Sin calendario en la sucursal no hay dónde crear el evento: la
          // service account no tiene "primary". Se avisa y se sigue.
          console.warn(
            'La sucursal no tiene google_calendar_id: la cita no se replica en Google Calendar.',
          );
        } else {
          googleEventId = eventIdForAppointment(apptId);
        }
      }

      const stmts: Stmt[] = [];

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
                 status, deposit_required, deposit_amount, notes,
                 google_calendar_id, google_calendar_event_id, created_by)
              VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?)`,
        args: [
          apptId,
          orgId,
          branchId,
          custId,
          startLocal,
          endLocal,
          dep > 0 ? 1 : 0,
          dep,
          notes.trim() || null,
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
            depositRef.trim()
              ? `[Seña] ${clientLabel} · ${depositRef.trim()}`
              : `[Seña] ${clientLabel}`,
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

      // Recién ahora el evento en Google, con el id que ya quedó guardado en la
      // cita. El resumen NO lleva el abono: el monto formateado ("$10,00")
      // volvía por el sync y el parser del título lo leía como parte del nombre
      // del cliente ("(abono 00)"). El dato va en la descripción, que el sync
      // no parsea.
      if (googleEventId && calendarId) {
        const firstAssigned = cats.find((c) => c.staffId)?.staffId ?? null;
        const firstStaff = staff.data?.find((x) => x.id === firstAssigned);
        const descLines = cats.map(
          (c) => `• ${c.category} — ${staffName(c.staffId)}`,
        );
        descLines.push('');
        descLines.push(`Abono: ${money(dep)}`);
        if (notes.trim()) descLines.push(`Observaciones: ${notes.trim()}`);
        descLines.push('Detalle y total: se cargan al atender.');
        const catLabel = cats.map((c) => c.category).join(', ');
        try {
          await createCalendarEvent({
            eventId: googleEventId,
            summary: clientLabel ? `${catLabel} — ${clientLabel}` : catLabel,
            description: descLines.join('\n'),
            startLocal,
            endLocal,
            calendarId,
            colorHex: firstStaff?.color,
          });
        } catch (e) {
          // El evento no llegó a existir: hay que soltar el id para que
          // reprogramar o borrar no intenten tocar un evento inexistente.
          console.warn('No se pudo crear el evento en Google Calendar:', e);
          await execute(
            `UPDATE appointment
                SET google_calendar_id = NULL, google_calendar_event_id = NULL
              WHERE id = ?`,
            [apptId],
          );
        }
      }
    },
    onSuccess: () => {
      invalidateAppointments(qc);
      invalidateCustomers(qc, orgId);
      // El aviso sobrevive al cambio de pantalla: se ve ya en el calendario.
      toast.success(
        'Cita creada',
        `${
          newClient
            ? fullName(firstName, lastName)
            : selectedCustomer
              ? customerName(selectedCustomer)
              : ''
        } · ${dayLabel(date).dm} ${time}`,
      );
      navigate(ROUTES.calendar);
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'No se pudo agendar.';
      setError(msg);
      toast.error('No se pudo agendar', msg);
    },
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

  // ── Paso 2: disponibilidad táctil ──

  /** Próximos 28 días como tira horizontal (el salón agenda a corto plazo). */
  const dayStrip = useMemo(() => {
    const out: string[] = [];
    const base = new Date(`${todayLocalISO()}T00:00:00`);
    for (let i = 0; i < 28; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      out.push(ymd(d));
    }
    // Si la fecha elegida cae fuera de la ventana (llegó por ?date=), la sumamos.
    if (!out.includes(date)) out.unshift(date);
    return out;
  }, [date]);

  /** Citas del día elegido (cualquier estilista), para medir cuán cargado está. */
  const dayAppts = useMemo(
    () =>
      (weekAppts.data ?? []).filter((r) => r.start_at.slice(0, 10) === date),
    [weekAppts.data, date],
  );

  /**
   * Horarios del día en pasos de 30 min: libre / ocupado (choca con alguna
   * estilista elegida) / pasado. `load` = citas del salón que se solapan, para
   * dar una idea de cuán lleno está ese horario cuando no hay estilista fija.
   */
  const slots = useMemo(() => {
    const hours = hoursForDate(date);
    if (!hours) return [];
    const openMin = toMinutes(hours.open);
    const closeMin = toMinutes(hours.close);
    const dur = reservedMinutes || DEFAULT_SERVICE_MINUTES;
    const now = new Date();
    const nowMin =
      date === todayLocalISO() ? now.getHours() * 60 + now.getMinutes() : -1;

    const out: {
      min: number;
      label: string;
      past: boolean;
      taken: boolean;
      load: number;
    }[] = [];
    for (let m = openMin; m + dur <= closeMin; m += 30) {
      let taken = false;
      for (const [key, d] of staffBlocks) {
        if (key === '__none') continue;
        if (overlaps(bookedByStaff.get(key) ?? [], m, m + d)) taken = true;
      }
      const load = dayAppts.filter(
        (r) => naiveToMin(r.start_at) < m + dur && m < naiveToMin(r.end_at),
      ).length;
      out.push({
        min: m,
        label: fromMinutes(m),
        past: m < nowMin,
        taken,
        load,
      });
    }
    return out;
  }, [date, reservedMinutes, staffBlocks, bookedByStaff, dayAppts]);

  /**
   * Si la hora elegida ya pasó o quedó ocupada (por cambio de día, de estilista
   * o de duración), proponemos el primer hueco libre del día. Evita que el
   * asistente quede con una hora inválida por defecto.
   */
  useEffect(() => {
    if (!slots.length) return;
    // La eligió el usuario: no se toca aunque cambien día, estilista o duración.
    if (timePicked.current) return;
    const current = slots.find((s) => s.label === time);
    if (current && !current.past && !current.taken) return;
    const next = slots.find((s) => !s.past && !s.taken);
    // Proponer el primer hueco libre es sincronizar el formulario con datos que
    // llegan async, no estado derivado: apenas la usuaria elige una hora manda.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next && next.label !== time) setTime(next.label);
    // `time` se omite a propósito: solo recalculamos cuando cambian los huecos,
    // así una hora elegida a mano (aunque esté ocupada) no se pisa sola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  const closedDay = !hoursForDate(date);
  const durationLabel = fmtDuration(reservedMinutes || DEFAULT_SERVICE_MINUTES);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-action">
      <PageHeader
        title="Agendar cita"
        onBack={() =>
          step > 1 ? setStep((step - 1) as 1 | 2) : navigate(ROUTES.calendar)
        }
      />

      {/* Indicador de pasos: en móvil solo el paso activo + barra de progreso */}
      <Steps step={step} />

      {/* ── Paso 1 · ¿Qué se va a hacer? ── */}
      {step === 1 && (
        <Card>
          <CardHeader
            title="¿Qué se va a hacer?"
            subtitle="Tocá una o varias categorías. El detalle se carga al atender."
          />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {SERVICE_CATEGORIES.map((c) => {
              const on = isCatOn(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCat(c)}
                  className={cn(
                    'flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl border p-3 text-center text-sm font-medium transition active:scale-[0.97]',
                    on
                      ? 'border-gold/60 bg-gold/15 text-gold-100 shadow-gold-glow'
                      : 'border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/[0.06]',
                  )}
                >
                  {c}
                  {/* Cuánto bloquea en la agenda, visible antes de elegir. */}
                  <span className="text-[11px] font-normal opacity-60">
                    {fmtDuration(minutesForCategory(c))}
                  </span>
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
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 sm:gap-3"
                >
                  <span className="w-[76px] shrink-0 text-xs font-medium text-white sm:w-[92px] sm:text-sm">
                    {c.category}
                  </span>
                  <div className="min-w-0 flex-1">
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
                    className="tap flex shrink-0 items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white"
                    title="Quitar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Paso 2 · ¿Cuándo? ── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Día: tira horizontal deslizable */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-white/70">Día</h3>
              <div className="flex items-center gap-2 text-xs text-white/50">
                Otra fecha
                <DateInput
                  value={date}
                  onChange={(v) => {
                    if (!v) return;
                    setDate(v);
                    setConflicts([]);
                  }}
                  clearable={false}
                  size="sm"
                  className="w-36"
                />
              </div>
            </div>
            <div className="edge-row snap-x snap-mandatory pb-1">
              {dayStrip.map((iso) => {
                const { wd, dm } = dayLabel(iso);
                const on = iso === date;
                const closed = !hoursForDate(iso);
                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => {
                      setDate(iso);
                      setConflicts([]);
                    }}
                    className={cn(
                      'flex w-[62px] shrink-0 snap-start flex-col items-center gap-0.5 rounded-2xl border px-2 py-2.5 transition active:scale-[0.97]',
                      on
                        ? 'border-gold/60 bg-gold/15 text-gold-100 shadow-gold-glow'
                        : closed
                          ? 'border-white/5 bg-white/[0.02] text-white/25'
                          : 'border-white/10 bg-white/[0.03] text-white/70',
                    )}
                  >
                    <span className="text-[11px] uppercase">{wd}</span>
                    <span className="text-lg font-semibold leading-none">
                      {iso.slice(8, 10)}
                    </span>
                    <span className="text-[10px] opacity-70">
                      {dm.slice(3)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Hora: rejilla táctil (móvil) + calendario semanal (escritorio) */}
          <Card className="p-4 lg:hidden">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-white/70">Hora</h3>
              <span className="text-xs text-white/40">
                Bloque de {durationLabel}
              </span>
            </div>

            {closedDay ? (
              <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100/90">
                El local está cerrado ese día. Podés elegir la hora igual: se
                agenda como hora extra.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((s) => {
                  const on = s.label === time;
                  return (
                    <button
                      key={s.min}
                      type="button"
                      onClick={() => pickTime(s.label)}
                      className={cn(
                        'flex min-h-[52px] flex-col items-center justify-center rounded-xl border text-sm font-semibold transition active:scale-[0.97]',
                        on
                          ? 'border-gold/60 bg-gold/15 text-gold-100 shadow-gold-glow'
                          : s.taken
                            ? 'border-danger/30 bg-danger/10 text-danger/70'
                            : s.past
                              ? 'border-white/5 bg-white/[0.02] text-white/25'
                              : 'border-white/10 bg-white/[0.03] text-white/80',
                      )}
                    >
                      {s.label}
                      <span className="text-[10px] font-normal opacity-70">
                        {s.taken
                          ? 'ocupado'
                          : s.past
                            ? 'pasó'
                            : s.load > 0
                              ? `${s.load} cita${s.load > 1 ? 's' : ''}`
                              : 'libre'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <TimeField className="mt-3" value={time} onChange={pickTime} />
          </Card>

          {/* Escritorio: calendario semanal con los huecos reales */}
          <Card className="hidden lg:block">
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
                setDate(ymd(d));
                setConflicts([]);
              }}
              onSelectSlot={(start) => {
                setDate(ymd(start));
                pickTime(
                  `${String(start.getHours()).padStart(2, '0')}:${String(
                    start.getMinutes(),
                  ).padStart(2, '0')}`,
                );
              }}
            />
            <TimeField className="mt-3" value={time} onChange={pickTime} />
          </Card>

          <p className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
            <span className="text-white/50">Elegido</span>
            <span className="font-medium text-white">
              {dayLabel(date).wd} {dayLabel(date).dm} · {time} ·{' '}
              <span className="text-white/50">{durationLabel}</span>
            </span>
          </p>
        </div>
      )}

      {/* ── Paso 3 · Cliente y abono ── */}
      {step === 3 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
          {/* Cliente */}
          <Card>
            <CardHeader title="Cliente" />

            <CustomerPicker
              customerId={customerId}
              newClient={newClient}
              selectedCustomer={selectedCustomer}
              firstName={firstName}
              lastName={lastName}
              phone={phone}
              clientSearch={clientSearch}
              clientMatches={clientMatches}
              phoneTaken={phoneTaken}
              renameTo={renameTo}
              useExistingBusy={useExistingClient.isPending}
              searchPlaceholder="Buscar por nombre o WhatsApp…"
              phoneUseHint="Usá esa ficha para esta cita en vez de crear un contacto nuevo."
              searchRef={searchRef}
              phoneRef={phoneRef}
              onSearchChange={setClientSearch}
              onPhoneChange={setPhone}
              onPickExisting={pickExisting}
              onStartNewClient={startNewClient}
              onClear={clearClient}
              onUseExisting={() => useExistingClient.mutate()}
              newClientBefore={
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    label="Nombre"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Nombre"
                  />
                  <Input
                    label="Apellido"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Apellido"
                  />
                </div>
              }
              newClientAfter={
                <>
                  <Button
                    variant="outline"
                    className="w-full"
                    loading={createClient.isPending}
                    disabled={
                      !firstName.trim() || !!validatePhone(phone) || !!phoneTaken
                    }
                    onClick={() => createClient.mutate()}
                  >
                    Guardar cliente
                  </Button>
                  <p className="text-xs text-white/40">
                    Queda registrado en la lista de clientes al guardarlo, aunque
                    todavía no agendes la cita.
                  </p>
                </>
              }
            />
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
                <div className="grid grid-cols-4 gap-2">
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
                          'min-h-[56px] rounded-xl border text-base font-semibold transition active:scale-[0.97]',
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
                      'min-h-[56px] rounded-xl border text-base font-semibold transition active:scale-[0.97]',
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
                    inputMode="decimal"
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
                  {!hasOpenCashToday ? (
                    <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        No podés cobrar la seña con la caja cerrada. Abrí la
                        caja de hoy desde la barra superior.
                      </span>
                    </p>
                  ) : (
                    depositIsCash && !openCash.data && (
                      <p className="flex items-start gap-1.5 text-xs text-amber-300/80">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{' '}
                        No hay caja abierta: la seña se registra pero no entra
                        al efectivo.
                      </p>
                    )
                  )}
                  {!depositIsCash && (
                    <div className="pt-2">
                      <Input
                        label="Nº de voucher (opcional)"
                        value={depositRef}
                        onChange={(e) => setDepositRef(e.target.value)}
                        placeholder="Nº de transferencia o voucher"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Resumen (ancho completo) */}
          <Card className="lg:col-span-2">
            <CardHeader title="Resumen" />
            <div className="space-y-4">
              {/* Observaciones de la cita: viaja a la ficha y al evento de Google. */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-white/60">
                  Observaciones (opcional)
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Pedido del cliente, avisos para el equipo…"
                  className="input-base w-full resize-y"
                />
              </label>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="shrink-0 text-white/50">Cuándo</span>
                  <span className="text-right font-medium text-white">
                    {dayLabel(date).wd} {dayLabel(date).dm} · {time}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                  <span className="shrink-0 text-white/50">Tiempo reservado</span>
                  <span className="text-right font-medium text-white">
                    {durationLabel}
                  </span>
                </div>
                {depositChosen && (
                  <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                    <span className="shrink-0 text-white/50">Abono</span>
                    <span className="kpi-gold font-medium">{money(dep)}</span>
                  </div>
                )}
                <ul className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
                  {cats.map((c) => (
                    <li
                      key={c.category}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="truncate text-white/80">{c.category}</span>
                      <span className="shrink-0 truncate text-white/50">
                        {staffName(c.staffId)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {isGoogleCalendarEnabled() && (
                <p className="text-xs text-white/40">
                  Se reservarán {durationLabel} en Google Calendar.
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
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="outline"
                      size="lg"
                      className="flex-1"
                      onClick={() => {
                        setConflicts([]);
                        setStep(2);
                      }}
                    >
                      Cambiar horario
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

      {/* Barra de acción fija (alcance táctil). En estos flujos la navegación
          inferior se oculta, así que la barra se apoya en el borde. */}
      <div className="action-bar [--nav-h:0px]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3">
          {step > 1 && (
            <Button
              variant="outline"
              size="lg"
              className="shrink-0 px-4"
              onClick={() => setStep((step - 1) as 1 | 2)}
              aria-label="Atrás"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Atrás</span>
            </Button>
          )}

          {step === 1 && (
            <>
              <p className="hidden flex-1 text-sm text-white/50 sm:block">
                {cats.length === 0
                  ? 'Elegí al menos una categoría'
                  : `${cats.length} categoría${cats.length > 1 ? 's' : ''}`}
              </p>
              <Button
                size="lg"
                className="flex-1 sm:flex-none"
                disabled={!canContinue}
                onClick={() => setStep(2)}
              >
                Elegir horario <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <p className="hidden flex-1 text-sm text-white/50 sm:block">
                {dayLabel(date).dm} · {time} · {durationLabel}
              </p>
              <Button
                size="lg"
                className="flex-1 sm:flex-none"
                onClick={() => setStep(3)}
              >
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          )}

          {step === 3 && conflicts.length === 0 && (
            <>
              <p className="hidden flex-1 text-sm text-white/50 sm:block">
                {!hasClient
                  ? 'Elegí el cliente'
                  : !clientReady
                    ? 'Escribí el nombre del cliente'
                    : !depositChosen
                      ? 'Elegí el abono'
                      : 'Todo listo para agendar'}
              </p>
              <Button
                className="flex-1 sm:flex-none"
                size="lg"
                disabled={
                  cats.length === 0 ||
                  !clientReady ||
                  !depositChosen ||
                  (dep > 0 && !hasOpenCashToday)
                }
                loading={save.isPending}
                onClick={() => attemptSchedule(false)}
              >
                <Check className="h-4 w-4" /> Agendar cita
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Indicador de pasos del asistente: compacto en móvil, con etiquetas en ≥sm. */
const STEP_LABELS = ['Qué', 'Cuándo', 'Cliente y abono'];

function Steps({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-2">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
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
                'truncate text-sm',
                active ? 'font-medium text-white' : 'text-white/45',
                // En móvil solo se lee la etiqueta del paso activo.
                active ? 'inline' : 'hidden sm:inline',
              )}
            >
              {label}
            </span>
            {n < STEP_LABELS.length && (
              <span className="h-px flex-1 bg-white/10" />
            )}
          </div>
        );
      })}
    </div>
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
        step={15}
        timeslots={2}
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
  notes: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  customer_nickname: string | null;
  customer_imported_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_birth_date: string | null;
  customer_tax_id: string | null;
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
  const toast = useToast();
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
        `SELECT a.id, a.status, a.deposit_amount, a.start_at, a.end_at, a.notes,
                a.customer_id, a.created_at,
                a.google_calendar_id, a.google_calendar_event_id,
                ${customerNameSql()} AS customer_name,
                c.first_name AS customer_first_name,
                c.last_name AS customer_last_name,
                c.nickname AS customer_nickname,
                c.imported_name AS customer_imported_name,
                c.phone AS customer_phone,
                c.email AS customer_email,
                c.birth_date AS customer_birth_date,
                c.tax_id AS customer_tax_id,
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

  // Seña realmente cobrada (pagos de la cita sin venta asociada todavía). Se
  // traen uno por uno para poder anular un abono mal registrado (duplicado).
  const deposits = useQuery({
    queryKey: ['appointment-deposits', id],
    queryFn: () =>
      query<DepositRow>(
        `SELECT p.id, p.amount, p.paid_at, p.reference, p.bank_account_id,
                pm.method_type, ba.name AS bank_name,
                cm.id AS movement_id, cs.status AS session_status,
                u.full_name AS created_by_name
           FROM payment p
           JOIN payment_method pm ON pm.id = p.payment_method_id
           LEFT JOIN bank_account ba ON ba.id = p.bank_account_id
           LEFT JOIN cash_movement cm ON cm.payment_id = p.id
           LEFT JOIN cash_session cs ON cs.id = cm.cash_session_id
           LEFT JOIN app_user u ON u.id = p.created_by
          WHERE p.appointment_id = ? AND p.sale_id IS NULL AND p.status = 'confirmed'
          ORDER BY p.paid_at`,
        [id],
      ),
  });
  const depositList = deposits.data ?? [];
  const depositPaid = depositList.reduce((a, d) => a + d.amount, 0);

  // Historial completo de pagos recibidos por la cita: abonos + pagos de la
  // venta ya facturada. Se arma acá para que la tarjeta "Pagos recibidos"
  // muestre todo en una sola línea de tiempo con quién cobró cada uno.
  const paymentsHistory = useQuery({
    queryKey: ['appointment-payments', id],
    queryFn: () =>
      query<PaymentRow>(
        `SELECT p.id, p.amount, p.paid_at, p.reference,
                pm.method_type, ba.name AS bank_name,
                u.full_name AS created_by_name,
                CASE WHEN p.sale_id IS NULL THEN 'deposit' ELSE 'sale' END AS kind
           FROM payment p
           JOIN payment_method pm ON pm.id = p.payment_method_id
           LEFT JOIN bank_account ba ON ba.id = p.bank_account_id
           LEFT JOIN app_user u ON u.id = p.created_by
           LEFT JOIN sale s ON s.id = p.sale_id
          WHERE p.status = 'confirmed'
            AND (p.appointment_id = ? OR s.appointment_id = ?)
          ORDER BY p.paid_at`,
        [id, id],
      ),
  });
  const paymentsList = paymentsHistory.data ?? [];

  // Historial del cliente: cuántas veces vino, promedio de gasto, último
  // colaborador y servicios habituales. Útil para abordar la cita conociendo
  // qué suele hacerse — info que antes había que ir a buscar a la ficha.
  const customerHistory = useQuery({
    queryKey: ['customer-history', head.data?.customer_id ?? '', id],
    enabled: !!head.data?.customer_id,
    queryFn: () => loadCustomerHistory(head.data!.customer_id!, id),
  });

  const serviceItems = (items.data ?? []).filter((i) => i.service_id);

  // Cita cerrada como atendida sin registrar el ingreso (cierre retroactivo):
  // no tiene venta, así que se le puede registrar la venta después. Solo la
  // atendida CON venta queda congelada.
  const noCharge = !!head.data && isNoCharge(head.data);
  const attendedWithSale = head.data?.status === 'attended' && !noCharge;

  const orgId = useOrgId();
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [voidDeposit, setVoidDeposit] = useState<DepositRow | null>(null);

  /**
   * Cualquier cambio de la cita refresca lo mismo: sus ítems, su cabecera, la
   * agenda, el dashboard, la disponibilidad de la semana y los contadores de
   * vencidas. Antes había dos helpers casi iguales, uno para los ítems y otro
   * para la cabecera, y según cuál usara la mutación quedaba media pantalla sin
   * actualizar.
   */
  const refresh = () => invalidateAppointments(qc, id);

  // Tras tocar abonos: la cita y TODO el dinero (cuentas, caja, arrastre y
  // ledger). Antes se refrescaban cuatro claves y el arrastre del cierre de caja
  // quedaba viejo hasta recargar la página.
  const refreshMoney = () => {
    refresh();
    invalidateFinance(qc, branchId);
  };

  // Observaciones de la cita: se guardan a mano (el botón aparece al cambiarlas).
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const savedNotes = head.data?.notes ?? '';
  const notesValue = notesDraft ?? savedNotes;
  const notesDirty = notesDraft !== null && notesDraft !== savedNotes;

  const saveNotes = useMutation({
    mutationFn: () =>
      execute('UPDATE appointment SET notes = ?, updated_at = ? WHERE id = ?', [
        notesValue.trim() || null,
        new Date().toISOString(),
        id,
      ]),
    onSuccess: () => {
      setNotesDraft(null);
      refresh();
      toast.success('Observaciones guardadas');
    },
    onError: (e: Error) => toast.error('No se pudo guardar', e.message),
  });

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
    onSuccess: refresh,
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
    onSuccess: refresh,
  });

  const addProduct = useMutation({
    mutationFn: async ({
      pid,
      qty,
      product,
    }: {
      pid: string;
      qty: number;
      product?: Product;
    }) => {
      const p = product ?? products.data?.find((x) => x.id === pid);
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
    onSuccess: refresh,
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) =>
      execute('DELETE FROM appointment_item WHERE id = ?', [itemId]),
    onSuccess: refresh,
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
    onSuccess: refresh,
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
    onSuccess: (_r, status) => {
      invalidateAppointments(qc, id);
      toast.success(APPT_STATUS_TOAST[status] ?? 'Cita actualizada');
    },
    onError: (e: Error) => toast.error('No se pudo cambiar el estado', e.message),
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
      m.set(k, (m.get(k) ?? 0) + (i.duration ?? minutesForCategory(i.category)));
    }
    return m.size ? Math.max(...m.values()) : 0;
  })();

  if (head.isLoading) return null;
  if (!head.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cita" onBack={goBack} />
        <Card>
          <EmptyState icon={UserRound} title="Cita no encontrada" />
        </Card>
      </div>
    );
  }

  const meta = APPOINTMENT_STATUS[head.data.status];

  // En móvil, fecha compacta ("sáb 19 sept"); en escritorio, la larga.
  const startDate = new Date(head.data.start_at);
  const fechaLarga = startDate.toLocaleDateString('es-EC', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const fechaCorta = startDate
    .toLocaleDateString('es-EC', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    })
    .replace('.', '');

  // created_at viene de la base como "YYYY-MM-DD HH:MM:SS" en UTC (sin zona):
  // lo normalizo a ISO-UTC para que dateShort/timeShort lo pasen a hora local.
  const createdIso = head.data.created_at
    ? head.data.created_at.includes('T')
      ? head.data.created_at
      : `${head.data.created_at.replace(' ', 'T')}Z`
    : null;

  const rules = commissionRules.data;
  const staffCommissions = commissionByStaff(serviceItems, rules);
  const totalCommission = staffCommissions.reduce((a, s) => a + s.amount, 0);

  const totalServicios = serviceItems.reduce(
    (a, i) => a + i.final_unit_price * i.quantity,
    0,
  );
  const totalProductos = all
    .filter((i) => i.product_id)
    .reduce((a, i) => a + i.final_unit_price * i.quantity, 0);

  const balance = Math.max(0, total - depositPaid);

  return (
    <div className="space-y-5 pb-action lg:pb-0">
      <PageHeader
        title="Atención de cita"
        onBack={goBack}
        right={<Badge tone={meta.tone}>{meta.label}</Badge>}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-6">
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
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
                  {head.data.customer_phone && (
                    <span>{head.data.customer_phone}</span>
                  )}
                  {head.data.customer_email && (
                    <span className="truncate">{head.data.customer_email}</span>
                  )}
                  <button
                    onClick={() => setCustomerOpen(true)}
                    className="flex items-center gap-1 font-medium text-gold-300 hover:underline"
                  >
                    <Pencil className="h-3 w-3" />
                    {head.data.customer_id ? 'Editar datos' : 'Agregar cliente'}
                  </button>
                </div>
              </div>
              <div className="grid w-full grid-cols-2 gap-x-6 gap-y-2 text-sm sm:w-auto sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-1">
                <div>
                  <span className="block text-xs text-white/40 sm:inline">
                    Fecha{' '}
                  </span>
                  <span className="text-white first-letter:uppercase">
                    <span className="sm:hidden">{fechaCorta}</span>
                    <span className="hidden sm:inline">{fechaLarga}</span>
                  </span>
                </div>
                <div>
                  <span className="block text-xs text-white/40 sm:inline">
                    Hora{' '}
                  </span>
                  <span className="text-white">
                    {timeShort(head.data.start_at)} – {timeShort(head.data.end_at)}
                  </span>
                </div>
                {reservedMinutes > 0 && (
                  <div>
                    <span className="block text-xs text-white/40 sm:inline">
                      Duración{' '}
                    </span>
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

            {/* Observaciones de la cita (lo que pidió el cliente, avisos…) */}
            <div className="mt-3 border-t border-white/10 pt-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-white/60">
                  Observaciones de la cita
                </span>
                <textarea
                  value={notesValue}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={2}
                  placeholder="Pedido del cliente, avisos para el equipo…"
                  className="input-base w-full resize-y"
                />
              </label>
              {notesDirty && (
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setNotesDraft(null)}
                  >
                    Descartar
                  </Button>
                  <Button
                    size="sm"
                    loading={saveNotes.isPending}
                    onClick={() => saveNotes.mutate()}
                  >
                    Guardar observaciones
                  </Button>
                </div>
              )}
            </div>
          </Card>

          {/* Detalle de venta */}
          <SaleItemsEditor
            items={all}
            staff={staff.data ?? []}
            services={services.data ?? []}
            products={products.data ?? []}
            rules={commissionRules.data}
            onUpdateItem={(itemId, patch) => updateItem.mutate({ itemId, patch })}
            onReassign={(itemId, staffId) =>
              reassign.mutate({ itemId, staffId })
            }
            onRemoveItem={(itemId) => removeItem.mutate(itemId)}
            onAddService={({ sid, stid }) => addService.mutate({ sid, stid })}
            onAddProduct={({ pid, qty, product }) =>
              addProduct.mutate({ pid, qty, product })
            }
          />

          {head.data.customer_id && (
            <CustomerHistoryCard
              history={customerHistory.data}
              loading={customerHistory.isLoading}
            />
          )}

          {paymentsList.length > 0 && (
            <PaymentsHistoryCard payments={paymentsList} />
          )}
        </div>

        {/* Resumen */}
        <div className="lg:col-span-1">
          <Card gold className="lg:sticky lg:top-4">
            <CardHeader title="Resumen" />
            <div className="space-y-4">
              <Select
                label="Estado"
                value={head.data.status}
                disabled={attendedWithSale}
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
              {attendedWithSale && (
                <div className="-mt-2 space-y-2">
                  <p className="text-xs text-white/40">
                    Cita atendida: ya tiene venta y cobro registrados.
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <button
                      onClick={() => setSaleOpen(true)}
                      className="text-xs font-medium text-gold-300 hover:underline"
                    >
                      Ver venta / corregir colaboradora
                    </button>
                    <button
                      onClick={() => setVoidOpen(true)}
                      className="text-xs font-medium text-danger hover:underline"
                    >
                      Anular venta y cobro
                    </button>
                  </div>
                </div>
              )}
              {noCharge && (
                <p className="-mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-xs text-amber-100">
                  Atendida <b>sin cobro registrado</b> (cierre retroactivo): no
                  tiene venta ni ingreso. Si la vas a cobrar, cargá el detalle y
                  confirmá la venta.
                </p>
              )}

              {/* Totales */}
              <div className="space-y-2 border-t border-white/10 pt-4 text-sm">
                <DetailRow label="Subtotal" value={money(subtotal)} />
                <DetailRow label="Total servicios" value={money(totalServicios)} />
                <DetailRow label="Total productos" value={money(totalProductos)} />
                <DetailRow label="Descuentos" value={`−${money(discountTotal)}`} />
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
                    {/* El abono cobrado es un dato tan importante como el saldo:
                        va destacado en verde, con el detalle de cada cobro
                        debajo para poder anular uno mal cargado (duplicado). */}
                    <div className="space-y-2 rounded-2xl border border-success/30 bg-success/[0.08] p-3 shadow-[0_0_24px_-8px_rgba(62,207,142,0.45)]">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-success/80">
                        <Wallet className="h-3.5 w-3.5 shrink-0" /> Abono ya
                        pagado
                      </p>
                      <p className="kpi-success text-3xl leading-none">
                        −{money(depositPaid)}
                      </p>
                      {!attendedWithSale && (
                        <ul className="space-y-1.5 border-t border-success/20 pt-2">
                          {depositList.map((d) => (
                            <li
                              key={d.id}
                              className="flex items-start justify-between gap-2 text-xs"
                            >
                              <span className="min-w-0">
                                <span className="font-semibold text-white/90">
                                  {money(d.amount)}
                                </span>
                                <span className="text-white/50">
                                  {' '}
                                  · {dateShort(d.paid_at)} · {timeShort(d.paid_at)}
                                </span>
                                <span className="block truncate text-[11px] text-white/40">
                                  {d.bank_name ?? 'Efectivo'}
                                  {d.created_by_name
                                    ? ` · ${d.created_by_name}`
                                    : ''}
                                </span>
                              </span>
                              <button
                                onClick={() => setVoidDeposit(d)}
                                className="shrink-0 font-medium text-danger hover:underline"
                              >
                                Anular
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t border-white/10 pt-2">
                      <span className="font-medium text-white/70">
                        Saldo a cobrar
                      </span>
                      <span className="kpi-gold text-2xl">
                        {money(balance)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Comisiones estilistas */}
              {staffCommissions.length > 0 && (
                <div className="space-y-2 border-t border-white/10 pt-4 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/40">
                    Comisiones estilistas
                  </p>
                  {staffCommissions.map((s) => (
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

              {!attendedWithSale && (
                <>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setDepositOpen(true)}
                  >
                    <Wallet className="h-4 w-4" /> Registrar abono
                  </Button>
                  <Button
                    className="hidden w-full lg:inline-flex"
                    disabled={sellableItems.length === 0}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Check className="h-4 w-4" /> Confirmar venta
                  </Button>
                </>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate(ROUTES.calendar)}
              >
                Volver a la agenda
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Cobro siempre a mano en móvil: total + acción, sin scrollear */}
      {!attendedWithSale && (
        <div className="action-bar [--nav-h:0px] lg:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide text-white/40">
                {depositPaid > 0 ? 'Saldo a cobrar' : 'Total'}
              </p>
              <p className="kpi-gold text-xl leading-tight">
                {money(depositPaid > 0 ? balance : total)}
              </p>
              {depositPaid > 0 && (
                <p className="kpi-success text-sm leading-tight">
                  Abono −{money(depositPaid)}
                </p>
              )}
            </div>
            <Button
              size="lg"
              disabled={sellableItems.length === 0}
              onClick={() => setConfirmOpen(true)}
            >
              <Check className="h-4 w-4" /> Confirmar venta
            </Button>
          </div>
        </div>
      )}

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

      {customerOpen && (
        <ApptCustomerModal
          appointmentId={id}
          orgId={orgId}
          customerId={head.data.customer_id}
          firstName={head.data.customer_first_name}
          lastName={head.data.customer_last_name}
          nickname={head.data.customer_nickname}
          importedName={head.data.customer_imported_name}
          phone={head.data.customer_phone}
          email={head.data.customer_email}
          birthDate={head.data.customer_birth_date}
          taxId={head.data.customer_tax_id}
          onClose={() => setCustomerOpen(false)}
          onDone={() => {
            setCustomerOpen(false);
            refresh();
            invalidateCustomers(qc, orgId);
          }}
        />
      )}

      {depositOpen && (
        <DepositModal
          appointmentId={id}
          orgId={orgId}
          branchId={branchId}
          userId={userId}
          customerName={head.data.customer_name}
          maxAmount={balance}
          onClose={() => setDepositOpen(false)}
          onDone={() => {
            setDepositOpen(false);
            refreshMoney();
          }}
        />
      )}

      {voidDeposit && (
        <VoidDepositModal
          deposit={voidDeposit}
          branchId={branchId}
          userId={userId}
          customerName={head.data.customer_name}
          onClose={() => setVoidDeposit(null)}
          onDone={() => {
            setVoidDeposit(null);
            refreshMoney();
          }}
        />
      )}

      {saleOpen && (
        <SaleDetailModal appointmentId={id} onClose={() => setSaleOpen(false)} />
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
            refreshMoney();
          }}
        />
      )}
    </div>
  );
}

/**
 * Datos del cliente editables desde la ficha de la cita, para no tener que
 * saltar a Clientes en medio de la atención. Si la cita no tenía cliente, se
 * crea uno y queda vinculado (el teléfono es único: se avisa si ya existe).
 */
function ApptCustomerModal({
  appointmentId,
  orgId,
  customerId,
  firstName: initialFirst,
  lastName: initialLast,
  nickname: initialNickname,
  importedName: initialImported,
  phone: initialPhone,
  email: initialEmail,
  birthDate: initialBirth,
  taxId: initialTaxId,
  onClose,
  onDone,
}: {
  appointmentId: string;
  orgId: string;
  customerId: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  importedName: string | null;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  taxId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<CustomerDraft>({
    firstName: initialFirst ?? '',
    lastName: initialLast ?? '',
    nickname: initialNickname ?? '',
    importedName: initialImported ?? '',
    phone: initialPhone ?? '',
    email: initialEmail ?? '',
    birth: initialBirth ?? '',
    taxId: initialTaxId ?? '',
  });
  const [error, setError] = useState('');
  /** Ficha que ya tiene el número que se acaba de escribir. */
  const [owner, setOwner] = useState<Customer | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  // Ficha completa del cliente de la cita: hace falta para combinar (el
  // encabezado solo trae nombre y contacto). Se pide al abrir el modal para que
  // "Combinar fichas" no quede esperando una consulta.
  const current = useQuery({
    queryKey: ['customer-row', customerId],
    enabled: !!customerId,
    queryFn: () =>
      queryOne<Customer>('SELECT * FROM customer WHERE id = ?', [customerId]),
  });

  const set = <K extends keyof CustomerDraft>(
    key: K,
    value: CustomerDraft[K],
  ) => {
    // Editar el teléfono descarta el aviso del número anterior.
    if (key === 'phone') {
      setError('');
      setOwner(null);
    }
    setDraft((d) => ({ ...d, [key]: value }));
  };

  /** Lo escrito en el formulario, listo para guardar o para combinar. */
  const patch: CustomerPatch = {
    first_name: draft.firstName.trim(),
    last_name: draft.lastName.trim() || null,
    nickname: draft.nickname.trim() || null,
    imported_name: draft.importedName.trim() || null,
    phone: draft.phone.trim() || null,
    email: normalizeEmail(draft.email) || null,
    birth_date: draft.birth || null,
    tax_id: draft.taxId.trim() || null,
  };

  const save = useMutation({
    mutationFn: async () => {
      const name = draft.firstName.trim();
      if (!name) throw new Error('El nombre del cliente es obligatorio.');
      const canonical = draft.phone.trim() || null;
      const phoneError = validatePhone(canonical);
      if (phoneError) throw new Error(phoneError);
      const email = normalizeEmail(draft.email);
      const emailError = validateEmail(email);
      if (emailError) throw new Error(emailError);
      if (canonical) {
        const hit = await findCustomerByPhone(orgId, canonical);
        if (hit && hit.id !== customerId) {
          // No es un callejón sin salida: el modal ofrece combinar las dos
          // fichas (o usar la que existe), sin borrar lo que se escribió.
          const err = new Error(
            `Ese número ya es de ${customerName(hit)}.`,
          ) as Error & { hit?: Customer };
          err.hit = hit;
          throw err;
        }
      }
      const now = new Date().toISOString();
      if (customerId) {
        await execute(
          `UPDATE customer
              SET first_name = ?, last_name = ?, nickname = ?, imported_name = ?,
                  phone = ?, email = ?,
                  birth_date = ?, tax_id = ?, updated_at = ?
            WHERE id = ?`,
          [
            name,
            draft.lastName.trim() || null,
            draft.nickname.trim() || null,
            draft.importedName.trim() || null,
            canonical,
            email || null,
            draft.birth || null,
            draft.taxId.trim() || null,
            now,
            customerId,
          ],
        );
        return;
      }
      // Cliente nuevo: se crea y se ata a la cita en un solo lote.
      const newId = genId();
      await batch([
        {
          sql: `INSERT INTO customer
                  (id, organization_id, first_name, last_name, nickname,
                   imported_name, phone, email, birth_date, tax_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            newId,
            orgId,
            name,
            draft.lastName.trim() || null,
            draft.nickname.trim() || null,
            draft.importedName.trim() || null,
            canonical,
            email || null,
            draft.birth || null,
            draft.taxId.trim() || null,
          ],
        },
        {
          sql: 'UPDATE appointment SET customer_id = ?, updated_at = ? WHERE id = ?',
          args: [newId, now, appointmentId],
        },
      ]);
    },
    onSuccess: () => {
      toast.success('Cliente de la cita actualizado');
      onDone();
    },
    onError: (e: Error & { hit?: Customer }) => {
      if (e.hit) {
        setOwner(e.hit);
        setError('');
        toast.error('Ese WhatsApp ya está en otra ficha', e.message);
        return;
      }
      const msg = e.message || 'No se pudo guardar el cliente.';
      setError(msg);
      toast.error('No se pudo guardar el cliente', msg);
    },
  });

  /**
   * La cita no tenía cliente y el número resultó ser de una ficha que ya existe:
   * se ata la cita a esa ficha y se le completan los huecos con lo que se
   * acababa de pedir (email, cumpleaños, apellido). Nada se sobrescribe.
   */
  const useExisting = useMutation({
    mutationFn: async () => {
      if (!owner) return [] as string[];
      const gap = fillCustomerGaps(owner, patch);
      await batch([
        ...(gap ? [gap.stmt] : []),
        {
          sql: 'UPDATE appointment SET customer_id = ?, updated_at = ? WHERE id = ?',
          args: [owner.id, new Date().toISOString(), appointmentId],
        },
      ]);
      return gap?.fields ?? [];
    },
    onSuccess: (fields) => {
      toast.success(
        `Cita vinculada a ${fullName(owner!.first_name, owner!.last_name)}`,
        fields.length > 0
          ? `Se le completó: ${fields.join(', ')}.`
          : 'Su ficha ya estaba completa.',
      );
      onDone();
    },
    onError: (e: Error) =>
      toast.error('No se pudo usar ese contacto', e.message),
  });

  const busy = save.isPending || useExisting.isPending;

  return (
    <>
      <Modal
        open={!mergeOpen}
        onClose={onClose}
        title={customerId ? 'Datos del cliente' : 'Agregar cliente'}
      >
        <div className="space-y-4">
          <CustomerFields
            draft={draft}
            set={set}
            notice={
              <DuplicatePhoneNotice
                owner={owner}
                busy={busy || (!!customerId && current.isLoading)}
                // Con ficha propia hay dos contactos de la misma persona: se
                // combinan. Sin ficha (cita importada sin cliente) no hay nada
                // que combinar, se usa la que existe.
                onMerge={
                  customerId && current.data
                    ? () => setMergeOpen(true)
                    : undefined
                }
                onUse={
                  customerId ? undefined : () => useExisting.mutate()
                }
              />
            }
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button
            className="w-full"
            disabled={!draft.firstName.trim()}
            loading={save.isPending}
            onClick={() => {
              setError('');
              save.mutate();
            }}
          >
            <Check className="h-4 w-4" /> Guardar
          </Button>
        </div>
      </Modal>

      {mergeOpen && owner && current.data && (
        <MergeClientsModal
          open
          a={current.data}
          b={owner}
          patches={{ [current.data.id]: patch }}
          hint="Los datos que acabás de escribir se guardan en la ficha que quede, y la cita se mueve con ella."
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            setMergeOpen(false);
            setOwner(null);
            onDone();
          }}
        />
      )}
    </>
  );
}

/**
 * Abono de la cita: un cobro adelantado atado a la cita (sale_id NULL), igual
 * que la seña que se toma al reservar. El efectivo entra a la caja abierta; una
 * cuenta bancaria no toca la caja física. Al confirmar la venta, estos abonos
 * se descuentan del saldo y quedan atribuidos a ella.
 */
function DepositModal({
  appointmentId,
  orgId,
  branchId,
  userId,
  customerName,
  maxAmount,
  onClose,
  onDone,
}: {
  appointmentId: string;
  orgId: string;
  branchId: string;
  userId: string | null;
  customerName: string | null;
  /** Saldo pendiente: sirve de referencia, no de tope rígido. */
  maxAmount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  const target = usePaymentTarget(orgId, branchId, dest);
  const { sessionId, effectiveDest, isCash, method, hasOpenCashToday } = target;
  const value = Number(amount) || 0;

  const save = useMutation({
    mutationFn: async () => {
      if (value <= 0) throw new Error('El monto del abono debe ser mayor a 0.');
      if (!method)
        throw new Error(
          `No hay un método de pago ${
            isCash ? 'en efectivo' : 'por transferencia'
          } configurado.`,
        );
      const label = customerName ?? 'cliente';
      const nowIso = new Date().toISOString();
      const paymentId = genId();
      const stmts: Stmt[] = [
        {
          sql: `INSERT INTO payment
                  (id, organization_id, branch_id, sale_id, appointment_id, payment_method_id,
                   bank_account_id, paid_at, amount, status, reference)
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            paymentId,
            orgId,
            branchId,
            appointmentId,
            method.id,
            isCash ? null : effectiveDest,
            nowIso,
            value,
            reference.trim()
              ? `[Abono] ${label} · ${reference.trim()}`
              : `[Abono] ${label}`,
          ],
        },
      ];
      if (isCash && sessionId) {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, payment_id, description, created_by)
                VALUES (?, ?, ?, 'cash_in', 'in', ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            sessionId,
            branchId,
            value,
            nowIso,
            paymentId,
            `Abono ${label}`,
            userId,
          ],
        });
      }
      await batch(stmts);
    },
    onSuccess: () => {
      toast.success('Abono registrado', money(Number(amount) || 0));
      onDone();
    },
    onError: (e) => {
      const msg =
        e instanceof Error ? e.message : 'No se pudo registrar el abono.';
      setError(msg);
      toast.error('No se pudo registrar el abono', msg);
    },
  });

  return (
    <Modal open onClose={onClose} title="Registrar abono">
      <div className="space-y-4">
        {maxAmount > 0 && (
          <p className="text-xs text-white/50">
            Saldo pendiente de la cita: {money(maxAmount)}
          </p>
        )}

        <Input
          label="Monto"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />

        <PaymentTargetFields
          target={target}
          onDest={setDest}
          reference={reference}
          onReference={setReference}
          noun="abono"
        />
        {error && <p className="text-xs text-danger">{error}</p>}

        <Button
          className="w-full"
          disabled={value <= 0 || !method || !hasOpenCashToday}
          loading={save.isPending}
          onClick={() => {
            setError('');
            save.mutate();
          }}
        >
          <Check className="h-4 w-4" /> Registrar abono
        </Button>
      </div>
    </Modal>
  );
}

interface DepositRow {
  id: string;
  amount: number;
  paid_at: string;
  reference: string | null;
  bank_account_id: string | null;
  method_type: string;
  bank_name: string | null;
  /** Movimiento de caja generado por el abono (solo si fue en efectivo). */
  movement_id: string | null;
  session_status: string | null;
  created_by_name: string | null;
}


/**
 * Anula UN abono de la cita (típicamente uno cargado dos veces por error):
 *  - el `payment` pasa a "voided", así deja de contar en ingresos y saldos, y
 *    el abono de la cita baja solo (el saldo a cobrar se recalcula);
 *  - si el abono fue en efectivo y su caja sigue abierta, se borra el
 *    `cash_movement` (la caja esperada baja sin dejar un movimiento fantasma);
 *  - si esa caja ya se cerró, se revierte con una salida en la caja abierta de
 *    hoy (requiere caja abierta, igual que la anulación de venta);
 *  - si fue a una cuenta bancaria, alcanza con anular el pago.
 */
function VoidDepositModal({
  deposit,
  branchId,
  userId,
  customerName,
  onClose,
  onDone,
}: {
  deposit: DepositRow;
  branchId: string;
  userId: string | null;
  customerName: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState('');

  const cash = useOpenCashSession(branchId);
  const sessionId = cash.data?.id ?? null;

  const inOpenCash = !!deposit.movement_id && deposit.session_status === 'open';
  const inClosedCash =
    !!deposit.movement_id && deposit.session_status !== 'open';
  const blocked = inClosedCash && !sessionId;

  const voidIt = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      const stmts: Stmt[] = [
        {
          sql: `UPDATE payment SET status = 'voided' WHERE id = ?`,
          args: [deposit.id],
        },
      ];
      if (inOpenCash) {
        stmts.push({
          sql: 'DELETE FROM cash_movement WHERE id = ?',
          args: [deposit.movement_id],
        });
      } else if (inClosedCash && sessionId) {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, payment_id, description, created_by)
                VALUES (?, ?, ?, 'adjustment', 'out', ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            sessionId,
            branchId,
            deposit.amount,
            now,
            deposit.id,
            `Anulación abono ${customerName ?? ''}`.trim(),
            userId,
          ],
        });
      }
      await batch(stmts);
    },
    onSuccess: onDone,
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'No se pudo anular el abono.'),
  });

  return (
    <Modal open onClose={onClose} title="Anular abono">
      <div className="space-y-4">
        <div className="rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>
              {dateShort(deposit.paid_at)} · {deposit.bank_name ?? 'Efectivo'}
            </span>
            <span className="kpi-gold">{money(deposit.amount)}</span>
          </div>
          {deposit.reference && (
            <p className="mt-1 truncate text-xs text-white/40">
              {deposit.reference}
            </p>
          )}
        </div>

        <p className="text-sm text-white/70">
          Este cobro deja de contar como ingreso y el abono de la cita baja{' '}
          {money(deposit.amount)}, así que el saldo a cobrar se recalcula solo.
          {inOpenCash && ' También se quita el efectivo de la caja abierta.'}
          {inClosedCash &&
            ' El efectivo entró en una caja ya cerrada: se revierte con una salida en la caja de hoy.'}
        </p>

        {blocked && (
          <p className="flex items-center gap-1.5 text-xs text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5" /> El abono fue en efectivo de
            una caja ya cerrada y no hay caja abierta. Abrí la caja para poder
            revertir el efectivo.
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
            disabled={voidIt.isPending || blocked}
            loading={voidIt.isPending}
            onClick={() => {
              setError('');
              voidIt.mutate();
            }}
          >
            Anular abono
          </Button>
        </div>
      </div>
    </Modal>
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
  const toast = useToast();
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
  const cash = useOpenCashSession(branchId);
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
      const stmts: Stmt[] = [];

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
    onSuccess: () => {
      toast.info('Venta anulada', 'Se revirtieron los cobros y la caja.');
      onDone();
    },
    onError: (e) => {
      const msg =
        e instanceof Error ? e.message : 'No se pudo anular la venta.';
      setError(msg);
      toast.error('No se pudo anular la venta', msg);
    },
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
 * asignado, % por defecto) y registra el cobro en la cuenta elegida. El efectivo
 * entra a la caja abierta; las cuentas bancarias no tocan la caja física.
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
  const toast = useToast();
  // Saldo a cobrar = total − seña ya pagada.
  // El monto a cobrar es el saldo (total − seña) y no es editable: se cobra
  // exactamente lo que resta de la venta.
  const balance = Math.max(0, total - depositPaid);
  // Destino del cobro: una cuenta bancaria (transferencia) o "cash" (efectivo).
  const [dest, setDest] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  const target = usePaymentTarget(orgId, branchId, dest);
  const { sessionId, effectiveDest, isCash, method, hasOpenCashToday } = target;

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
      const current = await queryOne<{
        status: AppointmentStatus;
        notes: string | null;
      }>('SELECT status, notes FROM appointment WHERE id = ?', [appointmentId]);
      // Una cita cerrada "sin cobro" está atendida pero no vendida: registrarle
      // la venta ahora es justamente lo que falta (y le quita la marca).
      const wasNoCharge = !!current && isNoCharge(current);
      if (current?.status === 'attended' && !wasNoCharge) {
        throw new Error('Esta cita ya fue atendida y cobrada.');
      }

      if (balance > 0 && !method)
        throw new Error(
          `No hay un método de pago ${
            isCash ? 'en efectivo' : 'por transferencia'
          } configurado.`,
        );

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
          assigned_staff_id: it.assigned_staff_id,
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
      const stmts: Stmt[] = [];

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
                  (id, organization_id, branch_id, sale_id, payment_method_id,
                   bank_account_id, paid_at, amount, status, reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            paymentId,
            orgId,
            branchId,
            saleId,
            method!.id,
            isCash ? null : effectiveDest,
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

      // La cita queda atendida. Si venía de un cierre "sin cobro", se le quita
      // la marca de las observaciones: ya tiene venta y cobro.
      if (wasNoCharge) {
        stmts.push({
          sql: `UPDATE appointment SET status = 'attended', notes = ?, updated_at = ? WHERE id = ?`,
          args: [stripNoCharge(current?.notes), now, appointmentId],
        });
      } else {
        stmts.push({
          sql: `UPDATE appointment SET status = 'attended', updated_at = ? WHERE id = ?`,
          args: [now, appointmentId],
        });
      }

      await batch(stmts);
    },
    onSuccess: () => {
      invalidateAppointments(qc, appointmentId);
      invalidateSales(qc, branchId);
      toast.success('Venta confirmada', `${customerName ?? 'Cliente'} · ${money(total)}`);
      onDone();
    },
    onError: (e) => {
      const msg =
        e instanceof Error ? e.message : 'No se pudo confirmar la venta.';
      setError(msg);
      toast.error('No se pudo confirmar la venta', msg);
    },
  });

  const canConfirm =
    items.length > 0 &&
    !confirm.isPending &&
    hasOpenCashToday &&
    (balance === 0 || (!!method && balance > 0));

  return (
    <Modal open onClose={onClose} title="Confirmar venta">
      <div className="space-y-4">
        <div className="space-y-1 rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>{customerName ?? 'Sin cliente'}</span>
            <span>Total {money(total)}</span>
          </div>
          {depositPaid > 0 && (
            <div className="flex items-center justify-between text-white/60">
              <span>Abono ya cobrado</span>
              <span className="kpi-success text-xl leading-none">
                −{money(depositPaid)}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-white/10 pt-1 font-medium text-white">
            <span>Saldo a cobrar</span>
            <span className="kpi-gold">{money(balance)}</span>
          </div>
        </div>

        <PaymentTargetFields
          target={target}
          onDest={setDest}
          reference={reference}
          onReference={setReference}
          extra={
            isRetroactive ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-300/80">
                <AlertTriangle className="h-3.5 w-3.5" /> Venta retroactiva: el
                servicio se registra con fecha {dateShort(serviceDay)}; el cobro
                entra a la caja de hoy.
              </p>
            ) : undefined
          }
        />
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


