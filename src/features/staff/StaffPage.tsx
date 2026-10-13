import { useState, useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Plus,
  HandCoins,
  Scissors,
  Scale,
  CalendarOff,
  ChevronRight,
} from 'lucide-react';
import { query, queryOne, batch, execute, type Stmt } from '@/lib/db';
import { genId, money, dateShort, fullName, todayISO } from '@/lib/format';
import { useOrgId, useBranchId, useSession } from '@/store/session';
import {
  Card,
  CardHeader,
  Badge,
  Button,
  Select,
  Input,
  Modal,
  EmptyState,
  useToast,
} from '@/components/ui';
import { ymd } from '@/lib/date';
import { ROUTES } from '@/config/constants';
import { useTimeOff } from './useTimeOff';
import { invalidateFinance } from '@/lib/queryClient';
import {
  AccountSelect,
  paymentMethodFor,
  usePaymentMethods,
  useBankAccounts,
} from '@/features/cashflow/accounts';
import { expenseStatements } from '@/features/cashflow/expense';
import { staffExpenseCategoryId } from './staffExpense';
import type {
  CashSession,
  StaffMember,
} from '@/types';

/**
 * Marca de un ajuste de comisión (cuadre del saldo acumulado por colaborador).
 * Se guarda como `staff_advance` con esta marca en `notes`: descuenta del saldo
 * acumulado de comisiones pero NO genera egreso ni movimiento de caja, y se
 * excluye de la liquidación semanal (es solo un ajuste de arranque).
 */
const ADJUST_COMMISSION_MARK = '[Ajuste de comisión]';

/** Color de reserva para colaboradores sin color asignado. */
const NO_COLOR = '#64748b';

/** El mismo color con opacidad, para fondos y bordes teñidos (#RGB o #RRGGBB). */
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  if (full.length !== 6) return hex;
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${full}${a}`;
}

/** Punto con el color del colaborador, para identificarlo en filas y listas. */
function StaffDot({ color }: { color: string | null }) {
  const c = color || NO_COLOR;
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: c, boxShadow: `0 0 0 3px ${tint(c, 0.25)}` }}
    />
  );
}

/**
 * Fondo de una fila de colaborador: un degradado con su color, que se apaga
 * hacia la mitad para no pelearse con los números. Lo usan las tablas de
 * liquidación y de saldos, que antes lo repetían tal cual.
 */
function staffRowStyle(color: string | null): CSSProperties {
  return {
    background: `linear-gradient(90deg, ${tint(color || NO_COLOR, 0.16)}, transparent 45%)`,
  };
}

/** Primera celda de esas tablas: punto de color + nombre. */
function StaffNameCell({
  color,
  name,
}: {
  color: string | null;
  name: string;
}) {
  return (
    <td className="py-2 text-white">
      <span className="flex items-center gap-2">
        <StaffDot color={color} />
        <span className="truncate">{name}</span>
      </span>
    </td>
  );
}

/** Iniciales del colaborador teñidas con su color. */
function StaffInitials({
  first,
  last,
  color,
}: {
  first: string;
  last: string | null;
  color: string | null;
}) {
  const c = color || NO_COLOR;
  // Toma la inicial de las dos primeras palabras del nombre completo: algunos
  // colaboradores tienen el nombre y el apellido juntos en `first_name`.
  const words = `${first ?? ''} ${last ?? ''}`.trim().split(/\s+/);
  const initials =
    ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{
        backgroundColor: tint(c, 0.22),
        color: c,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: tint(c, 0.55),
      }}
    >
      {initials}
    </span>
  );
}

export function StaffPage() {
  const orgId = useOrgId();
  const [advanceOpen, setAdvanceOpen] = useState(false);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Personal y nómina</h1>
        <Button onClick={() => setAdvanceOpen(true)}>
          <HandCoins className="h-4 w-4" /> Adelanto
        </Button>
      </div>

      <CommissionBalanceSection orgId={orgId} />

      <TeamActivitySection orgId={orgId} />

      <AbsencesSummaryCard />

      <AdvanceModal open={advanceOpen} onClose={() => setAdvanceOpen(false)} />
    </div>
  );
}

interface DailyServiceRow {
  staff_id: string;
  staff_name: string;
  service: string;
  client: string | null;
  /** Lo cobrado por el servicio (base de la comisión). */
  amount: number;
  /** La comisión que le corresponde al colaborador por ese servicio. */
  commission: number;
  /** 'primary' = responsable; 'assistant' = ayuda interna (no facturó). */
  role: string;
  /** Qué ayuda fue, cuando `role` es 'assistant'. */
  assist_label: string | null;
  sold_at: string;
}

type RangeKey = 'today' | 'yesterday' | 'week' | 'month';

const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  week: 'Esta semana',
  month: 'Este mes',
};

/** Límites locales (YYYY-MM-DD, inclusivos) del rango elegido. */
function rangeBounds(key: RangeKey): { from: string; to: string } {
  const now = new Date();
  if (key === 'today') return { from: todayISO(), to: todayISO() };
  if (key === 'yesterday') {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    return { from: ymd(y), to: ymd(y) };
  }
  if (key === 'week') return weekBounds(now);
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: ymd(first), to: ymd(last) };
}

/**
 * Actividad del equipo en un rango (hoy, ayer, esta semana, este mes): cada
 * tarjeta muestra al colaborador y los servicios que facturó en ese rango, con
 * su total. Fusiona el equipo con los servicios del período.
 */
function TeamActivitySection({ orgId }: { orgId: string }) {
  const branchId = useBranchId();
  const [range, setRange] = useState<RangeKey>('today');
  const { from, to } = useMemo(() => rangeBounds(range), [range]);
  const multiDay = from !== to;

  const staff = useQuery({
    queryKey: ['staff', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffMember>(
        'SELECT * FROM staff_member WHERE organization_id = ? ORDER BY active DESC, first_name',
        [orgId],
      ),
  });

  const rows = useQuery({
    queryKey: ['team-activity', branchId, from, to],
    enabled: !!branchId,
    queryFn: () =>
      query<DailyServiceRow>(
        `SELECT sss.staff_member_id AS staff_id,
                sm.first_name || CASE WHEN sm.last_name IS NOT NULL THEN ' ' || sm.last_name ELSE '' END AS staff_name,
                si.description AS service,
                c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS client,
                sss.basis_amount AS amount,
                sss.commission_amount AS commission,
                sss.participation_role AS role,
                sss.assist_label AS assist_label,
                s.sold_at AS sold_at
           FROM sale s
           JOIN sale_item si ON si.sale_id = s.id
           JOIN sale_service_staff sss ON sss.sale_item_id = si.id
           JOIN staff_member sm ON sm.id = sss.staff_member_id
           LEFT JOIN customer c ON c.id = s.customer_id
          WHERE s.branch_id = ?
            AND s.status IN ('completed','partially_refunded')
            AND date(s.sold_at) BETWEEN ? AND ?
          ORDER BY sm.first_name, s.sold_at`,
        [branchId, from, to],
      ),
  });

  /** Servicios del rango agrupados por colaborador, con ambos totales. */
  const byStaff = useMemo(() => {
    const m = new Map<
      string,
      { items: DailyServiceRow[]; billed: number; commission: number }
    >();
    for (const r of rows.data ?? []) {
      const g = m.get(r.staff_id) ?? { items: [], billed: 0, commission: 0 };
      g.items.push(r);
      // Una ayuda no facturó nada: solo reparte comisión, no suma a "Cobrado".
      g.billed += r.role === 'assistant' ? 0 : (r.amount ?? 0);
      g.commission += r.commission ?? 0;
      m.set(r.staff_id, g);
    }
    return m;
  }, [rows.data]);

  const members = staff.data ?? [];

  return (
    <Card>
      <CardHeader
        title="Actividad del equipo"
        subtitle="Lo cobrado por cada servicio y la comisión del colaborador"
        action={
          <div className="flex flex-wrap gap-1 rounded-xl bg-white/5 p-1">
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className={
                  range === k
                    ? 'rounded-lg bg-gradient-to-b from-gold-300 to-gold-500 px-3 py-1.5 text-xs font-semibold text-ink-950 shadow-gold-glow'
                    : 'rounded-lg px-3 py-1.5 text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white'
                }
              >
                {RANGE_LABELS[k]}
              </button>
            ))}
          </div>
        }
      />
      {members.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {members.map((s) => {
            const g = byStaff.get(s.id);
            const c = s.color || NO_COLOR;
            return (
              <div
                key={s.id}
                className="flex flex-col rounded-xl border p-3"
                style={{
                  borderColor: tint(c, 0.4),
                  borderLeftWidth: 3,
                  borderLeftColor: c,
                  background: `linear-gradient(135deg, ${tint(c, 0.18)}, transparent 65%)`,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <StaffInitials
                      first={s.first_name}
                      last={s.last_name}
                      color={s.color}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {fullName(s.first_name, s.last_name)}
                      </p>
                      <p className="text-xs text-white/40">
                        {s.employee_code ?? 'Sin código'} · Ciclo{' '}
                        {s.default_pay_cycle}
                      </p>
                    </div>
                  </div>
                  <Badge tone={s.active ? 'success' : 'muted'}>
                    {s.active ? 'Activo' : 'Inactivo'}
                  </Badge>
                </div>

                {g ? (
                  <div className="mt-3">
                    {/* Cabecera de columnas */}
                    <div
                      className="flex items-center gap-2 border-t pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-white/40"
                      style={{ borderTopColor: tint(c, 0.35) }}
                    >
                      <span className="flex-1">Servicio</span>
                      <span className="w-20 shrink-0 text-right">Cobrado</span>
                      <span className="w-20 shrink-0 text-right">Comisión</span>
                    </div>
                    <ul className="divide-y divide-white/5">
                      {g.items.map((it, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-2 py-1.5 text-sm"
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: c }}
                            />
                            <span className="min-w-0 truncate text-white/80">
                              {it.role === 'assistant'
                                ? `Ayuda: ${it.assist_label ?? 'asistencia'}`
                                : it.service}
                              <span className="text-white/40">
                                {it.client ? ` · ${it.client}` : ''}
                                {multiDay ? ` · ${dateShort(it.sold_at)}` : ''}
                              </span>
                            </span>
                          </span>
                          <span className="w-20 shrink-0 text-right text-white/70">
                            {it.role === 'assistant' ? '—' : money(it.amount)}
                          </span>
                          <span
                            className="w-20 shrink-0 text-right font-medium"
                            style={{ color: c }}
                          >
                            {money(it.commission)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {/* Dos totales */}
                    <div
                      className="flex items-center gap-2 border-t pt-2 text-sm font-semibold"
                      style={{ borderTopColor: tint(c, 0.35) }}
                    >
                      <span className="flex-1 text-white/60">Total</span>
                      <span className="w-20 shrink-0 text-right text-white">
                        {money(g.billed)}
                      </span>
                      <span
                        className="w-20 shrink-0 text-right"
                        style={{ color: c }}
                      >
                        {money(g.commission)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-white/40">
                    <Scissors className="h-3.5 w-3.5" /> Sin servicios en el período
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Users} title="Sin colaboradores" />
      )}
    </Card>
  );
}

/** Límites (lunes–domingo) de la semana que contiene a `ref`. */
function weekBounds(ref: Date): { from: string; to: string } {
  const diffToMon = (ref.getDay() + 6) % 7; // 0 = lunes
  const mon = new Date(ref);
  mon.setDate(ref.getDate() - diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: ymd(mon), to: ymd(sun) };
}

interface CommissionBalanceRow {
  staff_member_id: string;
  staff_name: string;
  color: string | null;
  accrued: number;
  advances: number;
  paid: number;
  pending: number;
}

/**
 * Saldo de comisiones acumulado a la fecha por colaborador:
 * comisiones acumuladas (de todas las ventas) − adelantos − pagos = pendiente.
 * Permite «cuadrar» el pendiente real (p. ej. comisiones ya pagadas antes de
 * usar el sistema) y «pagar/liquidar» el pendiente en un paso (egreso + baja).
 */
function CommissionBalanceSection({ orgId }: { orgId: string }) {
  const branchId = useBranchId();
  const [adjust, setAdjust] = useState<CommissionBalanceRow | null>(null);
  const [pay, setPay] = useState<CommissionBalanceRow | null>(null);

  const bal = useQuery({
    queryKey: ['commission-balance', branchId, orgId],
    enabled: !!branchId && !!orgId,
    queryFn: async (): Promise<CommissionBalanceRow[]> => {
      // "A la fecha" = hasta este instante. Se compara contra el timestamp UTC
      // actual (no contra date(...) con el día local): sold_at y paid_at se
      // guardan con toISOString() en UTC, así que un pago o venta de la noche
      // en UTC−5 ya cae en el día siguiente en UTC y date(x) <= hoy-local lo
      // dejaba fuera. Por eso un pago recién registrado no bajaba el pendiente.
      const nowIso = new Date().toISOString();
      const [staff, accrued, advances, payments] = await Promise.all([
        query<{ id: string; name: string; color: string | null }>(
          `SELECT id,
                  first_name || CASE WHEN last_name IS NOT NULL THEN ' ' || last_name ELSE '' END AS name,
                  color
             FROM staff_member
            WHERE organization_id = ? AND active = 1
            ORDER BY first_name`,
          [orgId],
        ),
        query<{ staff_member_id: string; total: number }>(
          `SELECT sss.staff_member_id AS staff_member_id,
                  ROUND(SUM(sss.commission_amount), 2) AS total
             FROM sale_service_staff sss
             JOIN sale_item si ON si.id = sss.sale_item_id
             JOIN sale s ON s.id = si.sale_id
            WHERE s.branch_id = ?
              AND s.status IN ('completed', 'partially_refunded')
              AND s.sold_at <= ?
            GROUP BY sss.staff_member_id`,
          [branchId, nowIso],
        ),
        // incluye ajustes (marca [Ajuste de comisión]) para el acumulado
        query<{ staff_member_id: string; total: number }>(
          `SELECT staff_member_id, ROUND(SUM(amount), 2) AS total
             FROM staff_advance
            WHERE branch_id = ? AND status = 'confirmed'
              AND advance_date <= ?
            GROUP BY staff_member_id`,
          [branchId, nowIso],
        ),
        // pagos de comisiones ya liquidados
        query<{ staff_member_id: string; total: number }>(
          `SELECT staff_member_id, ROUND(SUM(net_paid), 2) AS total
             FROM staff_payment
            WHERE branch_id = ? AND status = 'confirmed'
              AND paid_at <= ?
            GROUP BY staff_member_id`,
          [branchId, nowIso],
        ),
      ]);
      const accMap = new Map(accrued.map((c) => [c.staff_member_id, c.total]));
      const advMap = new Map(advances.map((a) => [a.staff_member_id, a.total]));
      const payMap = new Map(payments.map((p) => [p.staff_member_id, p.total]));
      return staff.map((s) => {
        const acc = accMap.get(s.id) ?? 0;
        const adv = advMap.get(s.id) ?? 0;
        const pd = payMap.get(s.id) ?? 0;
        return {
          staff_member_id: s.id,
          staff_name: s.name,
          color: s.color,
          accrued: acc,
          advances: adv,
          paid: pd,
          pending: Math.round((acc - adv - pd) * 100) / 100,
        };
      });
    },
  });

  const rows = bal.data ?? [];
  const totalPending = rows.reduce((a, r) => a + r.pending, 0);

  return (
    <Card>
      <CardHeader
        title="Saldo de comisiones a la fecha"
        subtitle="Comisiones acumuladas − adelantos = pendiente de pagar"
      />
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-white/40">
                <th className="pb-2">Colaborador</th>
                <th className="pb-2 text-right">Acumulado</th>
                <th className="pb-2 text-right">Adelantos</th>
                <th className="pb-2 text-right">Pagado</th>
                <th className="pb-2 text-right">Pendiente</th>
                <th className="pb-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.staff_member_id} style={staffRowStyle(r.color)}>
                  <StaffNameCell color={r.color} name={r.staff_name} />
                  <td className="py-2 text-right text-white/70">
                    {money(r.accrued)}
                  </td>
                  <td className="py-2 text-right text-danger">
                    {r.advances > 0 ? `−${money(r.advances)}` : money(0)}
                  </td>
                  <td className="py-2 text-right text-white/50">
                    {r.paid > 0 ? `−${money(r.paid)}` : money(0)}
                  </td>
                  <td
                    className={`py-2 text-right font-semibold ${
                      r.pending >= 0 ? 'text-gold-200' : 'text-danger'
                    }`}
                  >
                    {money(r.pending)}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center justify-end gap-2">
                      {r.pending > 0.001 && (
                        <Button size="sm" onClick={() => setPay(r)}>
                          <HandCoins className="h-4 w-4" /> Pagar
                        </Button>
                      )}
                      <button
                        title="Cuadrar saldo (ajustar pendiente real)"
                        onClick={() => setAdjust(r)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-white/60 hover:border-white/25 hover:bg-white/5 hover:text-gold-300"
                      >
                        <Scale className="h-3.5 w-3.5" /> Cuadrar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 text-sm font-semibold">
                <td className="pt-2 text-white/70" colSpan={4}>
                  Total pendiente
                </td>
                <td className="pt-2 text-right text-gold-200">
                  {money(totalPending)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="Sin colaboradores activos"
          description="Agregá colaboradores para ver su saldo de comisiones."
        />
      )}
      <p className="mt-3 text-xs text-white/40">
        El cuadre ajusta el pendiente al valor real (por ejemplo, comisiones ya
        pagadas antes de usar el sistema). Se registra como ajuste, no cuenta como
        egreso ni afecta la caja, y no aparece en la liquidación semanal.
      </p>

      {adjust && (
        <AdjustCommissionModal
          orgId={orgId}
          row={adjust}
          onClose={() => setAdjust(null)}
        />
      )}
      {pay && (
        <PayCommissionModal
          orgId={orgId}
          row={pay}
          onClose={() => setPay(null)}
        />
      )}
    </Card>
  );
}

function AdjustCommissionModal({
  orgId,
  row,
  onClose,
}: {
  orgId: string;
  row: CommissionBalanceRow;
  onClose: () => void;
}) {
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  const toast = useToast();
  const [real, setReal] = useState(String(row.pending.toFixed(2)));

  const methods = usePaymentMethods(orgId, true);

  const diff = Math.round((row.pending - Number(real)) * 100) / 100;

  const save = useMutation({
    mutationFn: async () => {
      if (diff === 0) return;
      // Un adelanto marcado reduce el pendiente acumulado (o lo aumenta si es
      // negativo). No genera egreso ni movimiento de caja: es solo un ajuste.
      const method =
        methods.data?.find((m) => m.method_type === 'transfer') ??
        methods.data?.[0];
      if (!method) throw new Error('No hay un método de pago configurado.');
      await execute(
        `INSERT INTO staff_advance
           (id, organization_id, branch_id, staff_member_id, advance_date, amount,
            payment_method_id, bank_account_id, cash_session_id, notes, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'confirmed', ?)`,
        [
          genId(),
          orgId,
          branchId,
          row.staff_member_id,
          todayISO(),
          diff,
          method.id,
          `${ADJUST_COMMISSION_MARK} · pendiente ${money(row.pending)} → ${money(
            Number(real),
          )}`,
          userId,
        ],
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commission-balance'] });
      onClose();
      toast.success('Comisiones cuadradas', `${row.staff_name} · ${money(Number(real) || 0)}`);
    },
    onError: (e: Error) => toast.error('No se pudo cuadrar', e.message),
  });

  return (
    <Modal open onClose={onClose} title={`Cuadrar comisiones · ${row.staff_name}`}>
      <div className="space-y-4">
        <div className="rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>Pendiente en el sistema</span>
            <span className="font-medium text-white">{money(row.pending)}</span>
          </div>
        </div>
        <Input
          label="Pendiente real (lo que le debés hoy)"
          type="number"
          step="0.01"
          value={real}
          onChange={(e) => setReal(e.target.value)}
        />
        {diff !== 0 && (
          <p className="text-xs text-white/50">
            Se registrará un ajuste de{' '}
            <span
              className={`font-semibold ${
                diff > 0 ? 'text-danger' : 'text-success'
              }`}
            >
              {diff > 0 ? '−' : '+'}
              {money(Math.abs(diff))}
            </span>{' '}
            sobre el pendiente para cuadrarlo.
          </p>
        )}
        <Button
          className="w-full"
          disabled={diff === 0}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          <Scale className="h-4 w-4" /> Cuadrar comisiones
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Pagar / liquidar comisiones pendientes de un colaborador en un paso:
 * registra un `staff_payment` (baja el pendiente) y el `expense` correspondiente
 * (egreso real que afecta la cuenta y el P&L). En efectivo mueve la caja.
 */
function PayCommissionModal({
  orgId,
  row,
  onClose,
}: {
  orgId: string;
  row: CommissionBalanceRow;
  onClose: () => void;
}) {
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  const toast = useToast();

  const [amount, setAmount] = useState(String(row.pending.toFixed(2)));
  const [account, setAccount] = useState(''); // 'cash' | bank id

  const methods = usePaymentMethods(orgId, true);
  const banks = useBankAccounts(orgId, true);
  const session = useQuery({
    queryKey: ['cash-session', branchId],
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

  const isCash = account === 'cash';
  const sessionId = session.data?.id ?? null;
  const needsSession = isCash && !sessionId;
  const value = Number(amount);
  const overflow = value > row.pending + 0.001;

  const save = useMutation({
    mutationFn: async () => {
      const method = paymentMethodFor(methods.data, isCash);
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : account;

      const categoryId = await staffExpenseCategoryId(orgId, 'commission');

      const label = `Pago de comisiones · ${row.staff_name}`;
      const paymentId = genId();
      const now = new Date().toISOString();

      const stmts: Stmt[] = [
        {
          sql: `INSERT INTO staff_payment
                  (id, organization_id, branch_id, staff_member_id, pay_period_id,
                   paid_at, gross_commission, advances_discount, other_deductions,
                   net_paid, payment_method_id, bank_account_id, cash_session_id,
                   status, reference, created_by)
                VALUES (?, ?, ?, ?, NULL, ?, ?, 0, 0, ?, ?, ?, ?, 'confirmed', ?, ?)`,
          args: [
            paymentId,
            orgId,
            branchId,
            row.staff_member_id,
            now,
            value,
            value,
            method.id,
            bankId,
            isCash ? sessionId : null,
            label,
            userId,
          ],
        },
      ];

      // Egreso real (afecta cuenta/caja y P&L).
      stmts.push(
        ...expenseStatements({
          orgId,
          branchId,
          expenseCategoryId: categoryId,
          paymentMethodId: method.id,
          bankAccountId: bankId,
          cashSessionId: sessionId,
          description: label,
          amount: value,
          userId,
        }),
      );

      await batch(stmts);
    },
    onSuccess: () => {
      invalidateFinance(qc, branchId);
      onClose();
      toast.success('Comisiones pagadas', `${row.staff_name} · ${money(Number(amount) || 0)}`);
    },
    onError: (e: Error) => toast.error('No se pudo pagar', e.message),
  });

  return (
    <Modal open onClose={onClose} title={`Pagar comisiones · ${row.staff_name}`}>
      <div className="space-y-4">
        <div className="rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>Pendiente</span>
            <span className="kpi-gold">{money(row.pending)}</span>
          </div>
        </div>
        <Input
          label="Monto a pagar"
          type="number"
          min="0"
          step="0.01"
          max={row.pending}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <AccountSelect
          label="Pagar desde"
          value={account}
          onChange={setAccount}
          accounts={banks.data}
        />
        {overflow && (
          <p className="text-xs text-danger">
            El monto supera el pendiente ({money(row.pending)}).
          </p>
        )}
        {needsSession && (
          <p className="text-xs text-danger">
            Para pagar en efectivo necesitás abrir la caja primero.
          </p>
        )}
        <p className="text-xs text-white/40">
          Se registra como egreso y baja el pendiente del colaborador.
        </p>
        <Button
          className="w-full"
          disabled={
            !account ||
            !value ||
            value <= 0 ||
            overflow ||
            needsSession
          }
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          <HandCoins className="h-4 w-4" /> Registrar pago
        </Button>
      </div>
    </Modal>
  );
}

function AdvanceModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const orgId = useOrgId();
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const qc = useQueryClient();
  const toast = useToast();

  const [staffId, setStaffId] = useState('');
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState(''); // 'cash' | id de cuenta bancaria

  const staff = useQuery({
    queryKey: ['staff', orgId],
    enabled: open && !!orgId,
    queryFn: () =>
      query<StaffMember>(
        'SELECT * FROM staff_member WHERE organization_id = ? AND active = 1 ORDER BY first_name',
        [orgId],
      ),
  });

  const methods = usePaymentMethods(orgId, open);

  const banks = useBankAccounts(orgId, open);

  // Sesión de caja abierta: necesaria para descontar un adelanto en efectivo.
  const session = useQuery({
    queryKey: ['cash-session', branchId],
    enabled: open && !!branchId,
    queryFn: () =>
      queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'open'
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      ),
  });

  const isCash = account === 'cash';
  const sessionId = session.data?.id ?? null;
  const needsSession = isCash && !sessionId;
  const selected = staff.data?.find((s) => s.id === staffId) ?? null;

  const save = useMutation({
    mutationFn: async () => {
      const method = paymentMethodFor(methods.data, isCash);
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : account;

      const categoryId = await staffExpenseCategoryId(orgId, 'advance');

      const person = staff.data?.find((s) => s.id === staffId);
      const label = `Adelanto de sueldo · ${
        person ? fullName(person.first_name, person.last_name) : ''
      }`.trim();
      const advanceId = genId();

      const stmts: Stmt[] = [
        {
          sql: `INSERT INTO staff_advance
                  (id, organization_id, branch_id, staff_member_id, advance_date, amount,
                   payment_method_id, bank_account_id, cash_session_id, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            advanceId,
            orgId,
            branchId,
            staffId,
            todayISO(),
            Number(amount),
            method.id,
            bankId,
            isCash ? sessionId : null,
            userId,
          ],
        },
      ];

      // Se registra también como egreso (y descuenta la caja si es efectivo).
      stmts.push(
        ...expenseStatements({
          orgId,
          branchId,
          expenseCategoryId: categoryId,
          paymentMethodId: method.id,
          bankAccountId: bankId,
          cashSessionId: sessionId,
          description: label,
          amount: Number(amount),
          userId,
        }),
      );

      await batch(stmts);
    },
    onSuccess: () => {
      toast.success(
        'Adelanto registrado',
        `${selected ? fullName(selected.first_name, selected.last_name) : 'Colaborador'} · ${money(Number(amount) || 0)}`,
      );
      setStaffId('');
      setAmount('');
      setAccount('');
      invalidateFinance(qc, branchId);
      onClose();
    },
    onError: (e: Error) => toast.error('No se pudo registrar el adelanto', e.message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Registrar adelanto de sueldo">
      <div className="space-y-4">
        <Select
          label="Colaborador"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          {staff.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {fullName(s.first_name, s.last_name)}
            </option>
          ))}
        </Select>
        {selected && (
          <div
            className="flex items-center gap-2.5 rounded-xl border p-2.5"
            style={{
              borderColor: tint(selected.color || NO_COLOR, 0.4),
              background: `linear-gradient(135deg, ${tint(
                selected.color || NO_COLOR,
                0.18,
              )}, transparent 70%)`,
            }}
          >
            <StaffInitials
              first={selected.first_name}
              last={selected.last_name}
              color={selected.color}
            />
            <p className="truncate text-sm font-medium text-white">
              {fullName(selected.first_name, selected.last_name)}
            </p>
          </div>
        )}
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <AccountSelect
          label="Cuenta"
          value={account}
          onChange={setAccount}
          accounts={banks.data}
        />
        {needsSession && (
          <p className="text-xs text-danger">
            Para un adelanto en efectivo necesitás abrir la caja primero.
          </p>
        )}
        <p className="text-xs text-white/40">
          Se registra automáticamente como egreso.
        </p>
        <Button
          className="w-full"
          disabled={!staffId || !amount || !account || needsSession}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          <Plus className="h-4 w-4" /> Guardar adelanto
        </Button>
      </div>
    </Modal>
  );
}

/* ──────────────────── Resumen de ausencias y cierres ──────────────────── */

/** "24 sep 2026" o "24 sep – 3 dic 2026" según el rango. */
function rangeLabel(a: string, b: string): string {
  return a === b ? dateShort(a) : `${dateShort(a)} – ${dateShort(b)}`;
}

/**
 * Tarjeta resumen que vive en /personal: muestra qué hay vigente hoy y lo más
 * próximo, con un botón que lleva a la pantalla completa (/personal/ausencias)
 * para registrar, ver conflictos y la línea de tiempo.
 */
function AbsencesSummaryCard() {
  const orgId = useOrgId();
  const timeOff = useTimeOff();
  const staff = useQuery({
    queryKey: ['staff-all', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffMember>(
        'SELECT * FROM staff_member WHERE organization_id = ? ORDER BY first_name',
        [orgId],
      ),
  });
  const nameOf = (id: string | null): string => {
    if (!id) return 'Todo el local';
    const s = staff.data?.find((x) => x.id === id);
    return s ? fullName(s.first_name, s.last_name) : '—';
  };

  const today = todayISO();
  const rows = timeOff.data ?? [];
  const current = rows.filter((r) => r.start_date <= today && r.end_date >= today);
  const upcoming = rows
    .filter((r) => r.start_date > today)
    .slice(0, 3);

  return (
    <Card>
      <CardHeader
        title="Ausencias y cierres"
        subtitle="Vacaciones del equipo y días cerrados. El agendado respeta estas fechas."
        action={
          <Link to={ROUTES.staffAbsences}>
            <Button size="sm" variant="outline">
              Gestionar <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="Sin ausencias ni cierres"
          description="Registrá una vacación, un permiso o un día de cierre para que el agendado lo respete."
          action={
            <Link to={ROUTES.staffAbsences}>
              <Button size="sm">
                <Plus className="h-4 w-4" /> Registrar
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/50">
              Hoy
            </p>
            {current.length === 0 ? (
              <p className="text-white/50">Todo el equipo disponible.</p>
            ) : (
              <ul className="space-y-1">
                {current.map((r) => (
                  <li key={r.id} className="text-white/80">
                    {nameOf(r.staff_member_id)} ·{' '}
                    <span className="text-white/50">
                      hasta {dateShort(r.end_date)}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {upcoming.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/50">
                Próximas
              </p>
              <ul className="space-y-1">
                {upcoming.map((r) => (
                  <li key={r.id} className="text-white/80">
                    {nameOf(r.staff_member_id)} ·{' '}
                    <span className="text-white/50">
                      {rangeLabel(r.start_date, r.end_date)}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

