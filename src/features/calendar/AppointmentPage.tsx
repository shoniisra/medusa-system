import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Scissors,
  Package,
  Check,
  UserRound,
  Stethoscope,
  Clock,
  AlertTriangle,
  Search,
  UserPlus,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { query, queryOne, batch, execute } from '@/lib/db';
import { genId, money, fullName, toLocalNaive, dateShort } from '@/lib/format';
import { useOrgId, useBranchId, useSession } from '@/store/session';
import { useCustomers, useServices, useProducts, useStaff } from '@/features/pos/useCatalog';
import {
  DEFAULT_SERVICE_MINUTES,
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
} from '@/components/ui';
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

/** Suma n días a una fecha "YYYY-MM-DD" (local). */
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toLocalNaive(d).slice(0, 10);
}

/** Etiqueta corta de día: { wd: 'lun', dm: '24 sep' }. */
function dayLabel(iso: string): { wd: string; dm: string } {
  const d = new Date(`${iso}T00:00:00`);
  return {
    wd: d.toLocaleDateString('es-EC', { weekday: 'short' }).replace('.', ''),
    dm: d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }),
  };
}

/** Slots sugeridos cada 30 min (07:00–21:00). */
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let m = 7 * 60; m <= 21 * 60; m += 30) out.push(fromMinutes(m));
  return out;
})();

/* ═══════════════════════════ Nueva cita ═══════════════════════════ */

interface DraftServiceRow {
  tempId: string;
  serviceId: string;
  name: string;
  price: number;
  duration: number;
  discount: number;
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
  const services = useServices();
  const staff = useStaff();

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

  // Servicios
  const [rows, setRows] = useState<DraftServiceRow[]>([]);
  const [category, setCategory] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);

  const filteredServices = useMemo(
    () =>
      (services.data ?? []).filter((s) => !category || s.category === category),
    [services.data, category],
  );

  // ── Cliente: buscador con foco automático y creación al vuelo ──
  const hasClient = !!customerId || newClient;
  const selectedCustomer = customers.data?.find((c) => c.id === customerId);

  useEffect(() => {
    if (!hasClient) searchRef.current?.focus();
  }, [hasClient]);

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

  // Se agrega automáticamente cuando servicio + estilista están completos.
  function addRowWith(sid: string, stid: string) {
    const s = services.data?.find((x) => x.id === sid);
    if (!s || !stid) return;
    setRows((r) => [
      ...r,
      {
        tempId: genId(),
        serviceId: s.id,
        name: s.name,
        price: s.base_price,
        duration: s.duration_minutes ?? DEFAULT_SERVICE_MINUTES,
        discount: 0,
        staffId: stid,
      },
    ]);
    setServiceId('');
    setStaffId('');
    setConflicts([]);
  }

  const subtotal = rows.reduce((a, r) => a + r.price, 0);
  const discountTotal = rows.reduce((a, r) => a + r.discount, 0);
  const total = Math.max(0, subtotal - discountTotal);
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
  // Principal = primera cuenta bancaria activa. Efectivo si no hay cuentas.
  const firstBankId = banks.data?.[0]?.id ?? '';
  const effectiveDest = depositDest || firstBankId || 'cash';
  const depositIsCash = effectiveDest === 'cash';

  // Bloques por colaborador: los servicios del mismo estilista se apilan; los de
  // estilistas distintos corren en paralelo. El tiempo reservado (lo que se
  // bloquea en Google) es el bloque más largo.
  const staffBlocks = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.staffId || '__none';
      m.set(k, (m.get(k) ?? 0) + r.duration);
    }
    return m;
  }, [rows]);
  const reservedMinutes = rows.length
    ? Math.max(...staffBlocks.values())
    : 0;

  const dayStrip = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDaysISO(todayLocalISO(), i)),
    [],
  );

  const staffName = (sid: string) => {
    const s = staff.data?.find((x) => x.id === sid);
    return s ? fullName(s.first_name, s.last_name) : 'Sin asignar';
  };

  // Citas del día (para el chequeo y el timeline visual). Una sola consulta.
  const dayAppts = useQuery({
    queryKey: ['day-availability', branchId, date],
    queryFn: () =>
      query<{ start_at: string; end_at: string; staff_id: string }>(
        `SELECT a.start_at, a.end_at, ai.assigned_staff_id AS staff_id
           FROM appointment a
           JOIN appointment_item ai ON ai.appointment_id = a.id
          WHERE a.branch_id = ?
            AND a.status NOT IN ('cancelled', 'no_show')
            AND substr(a.start_at, 1, 10) = ?
            AND ai.assigned_staff_id IS NOT NULL
          GROUP BY a.id, ai.assigned_staff_id`,
        [branchId, date],
      ),
    enabled: !!branchId && !!date,
  });

  const bookedByStaff = useMemo(() => {
    const m = new Map<string, Interval[]>();
    for (const r of dayAppts.data ?? []) {
      if (!r.staff_id) continue;
      const arr = m.get(r.staff_id) ?? [];
      arr.push({ startMin: naiveToMin(r.start_at), endMin: naiveToMin(r.end_at) });
      m.set(r.staff_id, arr);
    }
    return m;
  }, [dayAppts.data]);

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
      warnings.push(
        `Fuera del horario del local (${hours.open}–${hours.close}).`,
      );
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
      if (rows.length === 0) throw new Error('Agregá al menos un servicio.');
      if (!newClient && !customerId)
        throw new Error('Elegí un cliente o creá uno nuevo.');
      if (newClient && !firstName.trim())
        throw new Error('El nombre del cliente es obligatorio.');

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
            customers.data?.find((c) => c.id === customerId)?.first_name ?? '',
            customers.data?.find((c) => c.id === customerId)?.last_name,
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
        const firstStaff = staff.data?.find((x) => x.id === rows[0].staffId);
        try {
          const descLines = rows.map(
            (r) => `• ${r.name} (${staffName(r.staffId)}) — ${money(r.price)}`,
          );
          descLines.push('');
          descLines.push(`Total: ${money(total)}`);
          descLines.push(`Abono: ${money(dep)}`);
          descLines.push(`Saldo: ${money(Math.max(0, total - dep))}`);
          googleEventId = await createCalendarEvent({
            summary: `${rows.map((r) => r.name).join(', ')} — ${clientLabel} (abono ${money(dep)})`,
            description: descLines.join('\n'),
            startLocal,
            endLocal,
            calendarId,
            colorHex: firstStaff?.color,
          });
        } catch {
          // Si Google falla (permiso/red), igual guardamos la cita local.
          googleEventId = null;
        }
      }

      const apptId = genId();
      const stmts: { sql: string; args: (string | number | null)[] }[] = [];

      if (newClient) {
        stmts.push({
          sql: `INSERT INTO customer (id, organization_id, first_name, last_name, phone)
                VALUES (?, ?, ?, ?, ?)`,
          args: [custId, orgId, firstName.trim(), lastName.trim() || null, phone.trim() || null],
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

      for (const r of rows) {
        stmts.push({
          sql: `INSERT INTO appointment_item
                  (id, appointment_id, service_id, product_id, description, quantity,
                   list_unit_price, discount_amount, final_unit_price, assigned_staff_id)
                VALUES (?, ?, ?, NULL, ?, 1, ?, ?, ?, ?)`,
          args: [
            genId(),
            apptId,
            r.serviceId,
            r.name,
            r.price,
            r.discount,
            Math.max(0, r.price - r.discount),
            r.staffId || null,
          ],
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

  // Al confirmar: valida disponibilidad; si hay avisos, los muestra y espera
  // que el usuario decida (modificar o agendar igual).
  function attemptSchedule(force: boolean) {
    setError('');
    if (rows.length === 0) return;
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Header title="Agendar cita" onBack={() => navigate(ROUTES.calendar)} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
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
                    autoFocus
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
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-white/10"
                        >
                          <span className="text-sm text-white/90">
                            {fullName(c.first_name, c.last_name)}
                          </span>
                          {c.phone && (
                            <span className="text-xs text-white/40">
                              {c.phone}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}

                    <li>
                      <button
                        onClick={startNewClient}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-gold-200 hover:bg-white/10"
                      >
                        <UserPlus className="h-4 w-4 shrink-0" />
                        <span className="text-sm">
                          {clientMatches.length === 0 ? (
                            <>
                              Enter para crear «{clientSearch.trim()}» como
                              cliente nuevo
                            </>
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
              <Input
                ref={phoneRef}
                className="mt-3"
                label="WhatsApp"
                placeholder="Ej. 0991234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Card>

          {/* Servicios */}
          <Card>
            <CardHeader
              title="Servicios"
              subtitle="Elegí servicio y estilista: se agrega solo"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                  if (v && staffId) addRowWith(v, staffId);
                  else setServiceId(v);
                }}
              >
                <option value="">Seleccionar…</option>
                {filteredServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {money(s.base_price)} ·{' '}
                    {fmtDuration(s.duration_minutes ?? DEFAULT_SERVICE_MINUTES)}
                  </option>
                ))}
              </Select>
              <Select
                label="Estilista"
                value={staffId}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v && serviceId) addRowWith(serviceId, v);
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

            <div className="mt-4">
              {rows.length === 0 ? (
                <EmptyState
                  icon={Scissors}
                  title="Sin servicios"
                  description="Agregá uno o más servicios a la cita."
                />
              ) : (
                <ul className="divide-y divide-white/5">
                  {rows.map((r) => (
                    <li
                      key={r.tempId}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className="h-10 w-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              staff.data?.find((s) => s.id === r.staffId)
                                ?.color || '#64748b',
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">
                            {r.name}
                            <span className="ml-2 inline-flex items-center gap-0.5 text-xs font-normal text-white/40">
                              <Clock className="h-3 w-3" /> {fmtDuration(r.duration)}
                            </span>
                          </p>
                          <div className="mt-1 max-w-[220px]">
                            <Select
                              value={r.staffId}
                              onChange={(e) => {
                                const v = e.target.value;
                                setRows((rs) =>
                                  rs.map((x) =>
                                    x.tempId === r.tempId
                                      ? { ...x, staffId: v }
                                      : x,
                                  ),
                                );
                                setConflicts([]);
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
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="kpi-gold text-sm">
                          {money(r.price)}
                        </span>
                        <button
                          onClick={() =>
                            setRows((rs) =>
                              rs.filter((x) => x.tempId !== r.tempId),
                            )
                          }
                          className="text-white/40 hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Disponibilidad del día */}
          <Card>
            <CardHeader
              title="Disponibilidad"
              subtitle="Elegí día y hora; tocá un hueco libre en la barra"
            />

            {/* Controles de fecha / hora */}
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDate(addDaysISO(date, -1));
                  setConflicts([]);
                }}
                disabled={date <= todayLocalISO()}
                className="rounded-lg border border-white/10 p-2.5 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <Input
                label="Fecha"
                type="date"
                min={todayLocalISO()}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setConflicts([]);
                }}
                className="w-40"
              />
              <button
                type="button"
                onClick={() => {
                  setDate(addDaysISO(date, 1));
                  setConflicts([]);
                }}
                className="rounded-lg border border-white/10 p-2.5 text-white/60 hover:bg-white/10 hover:text-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="w-28">
                <Select
                  label="Hora"
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    setConflicts([]);
                  }}
                >
                  {!TIME_SLOTS.includes(time) && (
                    <option value={time}>{time}</option>
                  )}
                  {TIME_SLOTS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Tira de días (navegación horizontal) */}
            <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
              {dayStrip.map((d) => {
                const lbl = dayLabel(d);
                const active = d === date;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setDate(d);
                      setConflicts([]);
                    }}
                    className={cn(
                      'flex min-w-[52px] shrink-0 flex-col items-center rounded-lg border px-2 py-1.5 text-center transition',
                      active
                        ? 'border-gold/50 bg-gold/15 text-gold-100'
                        : 'border-white/10 text-white/60 hover:bg-white/5',
                    )}
                  >
                    <span className="text-[10px] uppercase">{lbl.wd}</span>
                    <span className="text-xs font-medium">{lbl.dm}</span>
                  </button>
                );
              })}
            </div>

            <AvailabilityTimeline
              date={date}
              loading={dayAppts.isLoading}
              staffList={staff.data ?? []}
              bookedByStaff={bookedByStaff}
              proposalStart={toMinutes(time)}
              proposalByStaff={staffBlocks}
              onPick={(hhmm) => {
                setTime(hhmm);
                setConflicts([]);
              }}
            />
          </Card>
        </div>

        {/* Resumen */}
        <div className="lg:col-span-1">
          <Card gold className="sticky top-4">
            <CardHeader title="Resumen" />
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                <span className="text-white/50">Cuándo</span>
                <span className="font-medium text-white">
                  {dayLabel(date).dm} · {time}
                </span>
              </div>

              <div>
                <span className="mb-1 block text-xs font-medium text-white/60">
                  Abono
                </span>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 20].map((v) => {
                    const active = !customDeposit && deposit === String(v);
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          setDeposit(String(v));
                          setCustomDeposit(false);
                        }}
                        className={cn(
                          'rounded-lg border px-3 py-1.5 text-sm transition',
                          active
                            ? 'border-gold/50 bg-gold/15 text-gold-100'
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
                    }}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-sm transition',
                      customDeposit
                        ? 'border-gold/50 bg-gold/15 text-gold-100'
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
                    placeholder="Valor del abono"
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                  />
                )}

                {dep > 0 && (
                  <div className="mt-3 space-y-1">
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

              <SummaryRows
                subtotal={subtotal}
                discountTotal={discountTotal}
                total={total}
                deposit={dep}
                reservedMinutes={reservedMinutes}
              />

              {isGoogleCalendarEnabled() ? (
                <p className="text-xs text-white/40">
                  Se reservarán {fmtDuration(reservedMinutes)} en Google Calendar.
                </p>
              ) : (
                <p className="text-xs text-white/30">
                  Configurá VITE_GOOGLE_CLIENT_ID para sincronizar con Google.
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
                      size="sm"
                      className="flex-1"
                      onClick={() => setConflicts([])}
                    >
                      Modificar
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      loading={save.isPending}
                      onClick={() => attemptSchedule(true)}
                    >
                      Agendar igual
                    </Button>
                  </div>
                </div>
              )}

              {conflicts.length === 0 && (
                <Button
                  className="w-full"
                  size="lg"
                  disabled={rows.length === 0}
                  loading={save.isPending}
                  onClick={() => attemptSchedule(false)}
                >
                  <Check className="h-4 w-4" /> Agendar cita
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
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
  google_calendar_id: string | null;
  google_calendar_event_id: string | null;
}

interface ItemRow {
  id: string;
  service_id: string | null;
  product_id: string | null;
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
  const qc = useQueryClient();
  const services = useServices();
  const products = useProducts();
  const staff = useStaff();

  const head = useQuery({
    queryKey: ['appointment-head', id],
    queryFn: () =>
      queryOne<ApptHead>(
        `SELECT a.id, a.status, a.deposit_amount, a.start_at, a.end_at,
                a.customer_id,
                a.google_calendar_id, a.google_calendar_event_id,
                c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS customer_name
           FROM appointment a
           LEFT JOIN customer c ON c.id = a.customer_id
          WHERE a.id = ?`,
        [id],
      ),
  });

  const items = useQuery({
    queryKey: ['appointment-items', id],
    queryFn: () =>
      query<ItemRow>(
        `SELECT ai.id, ai.service_id, ai.product_id, ai.description, ai.quantity,
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
  const productItems = (items.data ?? []).filter((i) => i.product_id);

  // Si se llega con ?atender=1 desde la agenda, se abre directo en modo atención.
  const [params] = useSearchParams();
  const [attending, setAttending] = useState(() => params.get('atender') === '1');
  const showProducts = attending || productItems.length > 0;

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
      invalidate();
    },
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) =>
      execute('DELETE FROM appointment_item WHERE id = ?', [itemId]),
    onSuccess: invalidate,
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

  const saveDeposit = useMutation({
    mutationFn: (amount: number) =>
      execute(
        'UPDATE appointment SET deposit_amount = ?, deposit_required = ?, updated_at = ? WHERE id = ?',
        [amount, amount > 0 ? 1 : 0, new Date().toISOString(), id],
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointment-head', id] });
    },
  });

  const all = items.data ?? [];
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
      <div className="mx-auto max-w-6xl space-y-6">
        <Header title="Cita" onBack={() => navigate(ROUTES.calendar)} />
        <Card>
          <EmptyState icon={UserRound} title="Cita no encontrada" />
        </Card>
      </div>
    );
  }

  const meta = APPOINTMENT_STATUS[head.data.status];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Header
        title="Atención de cita"
        onBack={() => navigate(ROUTES.calendar)}
        right={<Badge tone={meta.tone}>{meta.label}</Badge>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title={head.data.customer_name ?? 'Sin cliente'}
              subtitle="Cliente"
              action={
                !showProducts ? (
                  <Button size="sm" onClick={() => setAttending(true)}>
                    <Stethoscope className="h-4 w-4" /> Atender
                  </Button>
                ) : undefined
              }
            />
          </Card>

          {/* Servicios */}
          <Card>
            <CardHeader
              title="Servicios"
              subtitle="Elegí servicio y estilista: se agrega solo"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                  if (v && staffId) addService.mutate({ sid: v, stid: staffId });
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

            <ItemList
              rows={serviceItems}
              emptyIcon={Scissors}
              emptyTitle="Sin servicios"
              onRemove={(itemId) => removeItem.mutate(itemId)}
              staffOptions={staff.data ?? []}
              onReassign={(itemId, newStaff) =>
                reassign.mutate({ itemId, staffId: newStaff })
              }
            />
          </Card>

          {/* Productos (solo al atender) */}
          {showProducts && (
            <Card>
              <CardHeader title="Productos" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

              <ItemList
                rows={productItems}
                emptyIcon={Package}
                emptyTitle="Sin productos"
                onRemove={(itemId) => removeItem.mutate(itemId)}
              />
            </Card>
          )}
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

              {depositPaid > 0 && (
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                  <span className="text-white/50">Seña cobrada</span>
                  <span className="font-medium text-emerald-300">
                    {money(depositPaid)}
                  </span>
                </div>
              )}

              <SummaryRows
                subtotal={subtotal}
                discountTotal={discountTotal}
                total={total}
                deposit={depositPaid}
                reservedMinutes={reservedMinutes}
              />

              {head.data.status !== 'attended' && (
                <Button
                  className="w-full"
                  disabled={all.length === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Check className="h-4 w-4" /> Confirmar Venta
                </Button>
              )}

              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  loading={saveDeposit.isPending}
                  onClick={() => saveDeposit.mutate(depositPaid)}
                >
                  Guardar
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate(ROUTES.calendar)}
                >
                  Volver
                </Button>
              </div>
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
          items={all}
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
  const balance = Math.max(0, total - depositPaid);
  const [amount, setAmount] = useState(String(balance));
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
      const pay = Number(amount);
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
    (Number(amount) === 0 || (!!methodId && Number(amount) > 0));

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

        <Input
          label="Monto a cobrar"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

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

interface StaffOpt {
  id: string;
  first_name: string;
  last_name: string | null;
}

function ItemList({
  rows,
  emptyIcon,
  emptyTitle,
  onRemove,
  staffOptions,
  onReassign,
}: {
  rows: ItemRow[];
  emptyIcon: typeof Scissors;
  emptyTitle: string;
  onRemove: (id: string) => void;
  staffOptions?: StaffOpt[];
  onReassign?: (itemId: string, staffId: string | null) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState icon={emptyIcon} title={emptyTitle} />
      </div>
    );
  }
  return (
    <ul className="mt-4 divide-y divide-white/5">
      {rows.map((i) => (
        <li key={i.id} className="flex items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {i.service_id && (
              <span
                className="h-10 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: i.staff_color || '#64748b' }}
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {i.description}
                {i.service_id ? (
                  <span className="ml-2 text-xs font-normal text-white/40">
                    {fmtDuration(i.duration ?? DEFAULT_SERVICE_MINUTES)}
                  </span>
                ) : null}
              </p>
              {i.service_id && onReassign && staffOptions ? (
                <div className="mt-1 max-w-[220px]">
                  <Select
                    value={i.assigned_staff_id ?? ''}
                    onChange={(e) =>
                      onReassign(i.id, e.target.value || null)
                    }
                  >
                    <option value="">Sin asignar</option>
                    {staffOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {fullName(s.first_name, s.last_name)}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <p className="text-xs text-white/40">
                  {i.quantity} × {money(i.final_unit_price)}
                  {i.service_id && i.staff_name ? ` · ${i.staff_name}` : ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="kpi-gold text-sm">
              {money(i.final_unit_price * i.quantity)}
            </span>
            <button
              onClick={() => onRemove(i.id)}
              className="text-white/40 hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SummaryRows({
  subtotal,
  discountTotal,
  total,
  deposit,
  reservedMinutes,
}: {
  subtotal: number;
  discountTotal: number;
  total: number;
  deposit: number;
  reservedMinutes?: number;
}) {
  const saldo = Math.max(0, total - deposit);
  return (
    <div className="space-y-2 border-t border-white/10 pt-4 text-sm">
      {reservedMinutes != null && (
        <Row label="Tiempo reservado" value={fmtDuration(reservedMinutes)} />
      )}
      <Row label="Subtotal" value={money(subtotal)} />
      <Row label="Descuentos" value={`−${money(discountTotal)}`} />
      <Row label="Abono" value={`−${money(deposit)}`} />
      <div className="flex items-center justify-between border-t border-white/10 pt-2">
        <span className="font-medium text-white/70">Saldo</span>
        <span className="kpi-gold text-2xl">{money(saldo)}</span>
      </div>
      <p className="text-right text-xs text-white/40">Total {money(total)}</p>
    </div>
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

interface StaffLite {
  id: string;
  first_name: string;
  last_name: string | null;
  color?: string | null;
}

/** Línea de tiempo por estilista: ocupado (rojo) vs libre; el bloque propuesto
 *  se dibuja en dorado (o rojo si choca). Clic en la barra fija la hora. */
function AvailabilityTimeline({
  date,
  loading,
  staffList,
  bookedByStaff,
  proposalStart,
  proposalByStaff,
  onPick,
}: {
  date: string;
  loading: boolean;
  staffList: StaffLite[];
  bookedByStaff: Map<string, Interval[]>;
  proposalStart: number;
  proposalByStaff: Map<string, number>;
  onPick: (hhmm: string) => void;
}) {
  const hours = hoursForDate(date);
  if (!hours) {
    return (
      <p className="text-sm text-white/40">El local está cerrado ese día.</p>
    );
  }
  if (loading) {
    return <p className="text-sm text-white/40">Cargando disponibilidad…</p>;
  }
  if (staffList.length === 0) {
    return <p className="text-sm text-white/40">Sin estilistas activos.</p>;
  }

  const dayStart = toMinutes(hours.open);
  const dayEnd = toMinutes(hours.close);
  const span = Math.max(1, dayEnd - dayStart);
  const clamp = (m: number) => Math.min(dayEnd, Math.max(dayStart, m));
  const pct = (m: number) => ((clamp(m) - dayStart) / span) * 100;

  const ticks: number[] = [];
  for (let m = dayStart; m <= dayEnd; m += 60) ticks.push(m);

  return (
    <div className="space-y-2">
      <div className="relative ml-28 h-4 text-[10px] text-white/30">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${pct(t)}%` }}
          >
            {fromMinutes(t)}
          </span>
        ))}
      </div>

      {staffList.map((s) => {
        const booked = bookedByStaff.get(s.id) ?? [];
        const dur = proposalByStaff.get(s.id);
        const pEnd = dur != null ? proposalStart + dur : null;
        const conflict = pEnd != null && overlaps(booked, proposalStart, pEnd);
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div className="flex w-28 shrink-0 items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.color || '#64748b' }}
              />
              <span className="truncate text-xs text-white/70">
                {fullName(s.first_name, s.last_name)}
              </span>
            </div>
            <div
              className="relative h-7 flex-1 cursor-pointer overflow-hidden rounded-md bg-white/5"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const p = (e.clientX - r.left) / r.width;
                const m = Math.round((dayStart + p * span) / 30) * 30;
                onPick(fromMinutes(clamp(m)));
              }}
            >
              {booked.map((b, i) => (
                <div
                  key={i}
                  className="absolute inset-y-0 bg-rose-500/40"
                  style={{
                    left: `${pct(b.startMin)}%`,
                    width: `${Math.max(0, pct(b.endMin) - pct(b.startMin))}%`,
                  }}
                />
              ))}
              {dur != null && pEnd != null && (
                <div
                  className={cn(
                    'absolute inset-y-0 rounded-sm border-2',
                    conflict
                      ? 'border-rose-400 bg-rose-400/20'
                      : 'border-gold bg-gold/25',
                  )}
                  style={{
                    left: `${pct(proposalStart)}%`,
                    width: `${Math.max(2, pct(pEnd) - pct(proposalStart))}%`,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}

      <p className="ml-28 flex items-center gap-4 text-[11px] text-white/40">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-rose-500/40" />
          Ocupado
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm border border-gold bg-gold/25" />
          Tu cita
        </span>
      </p>
    </div>
  );
}
