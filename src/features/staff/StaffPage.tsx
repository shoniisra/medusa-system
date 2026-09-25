import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Plus,
  HandCoins,
  Scissors,
  ChevronLeft,
  ChevronRight,
  Scale,
} from 'lucide-react';
import { query, queryOne, batch, execute } from '@/lib/db';
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
} from '@/components/ui';
import type {
  BankAccount,
  CashSession,
  PaymentMethod,
  StaffMember,
} from '@/types';

/**
 * Marca de un ajuste de comisión (cuadre del saldo acumulado por colaborador).
 * Se guarda como `staff_advance` con esta marca en `notes`: descuenta del saldo
 * acumulado de comisiones pero NO genera egreso ni movimiento de caja, y se
 * excluye de la liquidación semanal (es solo un ajuste de arranque).
 */
const ADJUST_COMMISSION_MARK = '[Ajuste de comisión]';

export function StaffPage() {
  const orgId = useOrgId();
  const [advanceOpen, setAdvanceOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Personal y nómina</h1>
        <Button onClick={() => setAdvanceOpen(true)}>
          <HandCoins className="h-4 w-4" /> Adelanto
        </Button>
      </div>

      <LiquidationSection orgId={orgId} />

      <CommissionBalanceSection orgId={orgId} />

      <TeamDailySection orgId={orgId} />

      <AdvanceModal open={advanceOpen} onClose={() => setAdvanceOpen(false)} />
    </div>
  );
}

interface DailyServiceRow {
  staff_id: string;
  staff_name: string;
  service: string;
  client: string | null;
  amount: number;
  sold_at: string;
}

/**
 * Colaboradores del salón en un grid de tarjetas. Cada tarjeta muestra al
 * colaborador y, si tuvo servicios facturados en la fecha elegida, los lista
 * debajo con su total. Fusiona el equipo con los servicios del día.
 */
function TeamDailySection({ orgId }: { orgId: string }) {
  const branchId = useBranchId();
  const [day, setDay] = useState(todayISO());

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
    queryKey: ['daily-services', branchId, day],
    enabled: !!branchId,
    queryFn: () =>
      query<DailyServiceRow>(
        `SELECT sss.staff_member_id AS staff_id,
                sm.first_name || CASE WHEN sm.last_name IS NOT NULL THEN ' ' || sm.last_name ELSE '' END AS staff_name,
                si.description AS service,
                c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS client,
                sss.basis_amount AS amount,
                s.sold_at AS sold_at
           FROM sale s
           JOIN sale_item si ON si.sale_id = s.id
           JOIN sale_service_staff sss ON sss.sale_item_id = si.id
           JOIN staff_member sm ON sm.id = sss.staff_member_id
           LEFT JOIN customer c ON c.id = s.customer_id
          WHERE s.branch_id = ?
            AND s.status IN ('completed','partially_refunded')
            AND date(s.sold_at) = ?
          ORDER BY sm.first_name, s.sold_at`,
        [branchId, day],
      ),
  });

  /** Servicios del día agrupados por colaborador. */
  const byStaff = useMemo(() => {
    const m = new Map<string, { items: DailyServiceRow[]; total: number }>();
    for (const r of rows.data ?? []) {
      const g = m.get(r.staff_id) ?? { items: [], total: 0 };
      g.items.push(r);
      g.total += r.amount ?? 0;
      m.set(r.staff_id, g);
    }
    return m;
  }, [rows.data]);

  const members = staff.data ?? [];

  return (
    <Card>
      <CardHeader
        title="Colaboradores"
        subtitle="Equipo del salón y sus servicios del día"
        action={
          <div className="w-44">
            <Input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </div>
        }
      />
      {members.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {members.map((s) => {
            const g = byStaff.get(s.id);
            return (
              <div
                key={s.id}
                className="flex flex-col rounded-xl border border-white/10 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {fullName(s.first_name, s.last_name)}
                    </p>
                    <p className="text-xs text-white/40">
                      {s.employee_code ?? 'Sin código'} · Ciclo{' '}
                      {s.default_pay_cycle}
                    </p>
                  </div>
                  {g ? (
                    <span className="kpi-gold shrink-0 text-sm">
                      {money(g.total)}
                    </span>
                  ) : (
                    <Badge tone={s.active ? 'success' : 'muted'}>
                      {s.active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  )}
                </div>

                {g ? (
                  <ul className="mt-3 divide-y divide-white/5 border-t border-white/5 pt-1">
                    {g.items.map((it, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate text-white/80">
                          {it.service}
                          <span className="text-white/40">
                            {it.client ? ` · ${it.client}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 font-medium text-white">
                          {money(it.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-white/40">
                    <Scissors className="h-3.5 w-3.5" /> Sin servicios ese día
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

interface LiquidationRow {
  staff_member_id: string;
  staff_name: string;
  commission_total: number;
  advances_total: number;
  net_payable: number;
}

const ymdLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/** Límites (lunes–domingo) de la semana que contiene a `ref`. */
function weekBounds(ref: Date): { from: string; to: string } {
  const diffToMon = (ref.getDay() + 6) % 7; // 0 = lunes
  const mon = new Date(ref);
  mon.setDate(ref.getDate() - diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: ymdLocal(mon), to: ymdLocal(sun) };
}

/**
 * Liquidación por semana: comisiones − adelantos = neto a pagar.
 * Se calcula al vuelo desde las ventas y adelantos reales del rango (no depende
 * de periodos pre-creados). Por defecto muestra la semana actual.
 */
function LiquidationSection({ orgId }: { orgId: string }) {
  const branchId = useBranchId();
  const [weekRef, setWeekRef] = useState(() => new Date());
  const { from, to } = useMemo(() => weekBounds(weekRef), [weekRef]);

  const shiftWeek = (days: number) =>
    setWeekRef((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + days);
      return n;
    });

  const liq = useQuery({
    queryKey: ['liquidation', branchId, from, to],
    enabled: !!branchId && !!orgId,
    queryFn: async (): Promise<LiquidationRow[]> => {
      const [staff, commissions, advances] = await Promise.all([
        query<{ id: string; name: string }>(
          `SELECT id,
                  first_name || CASE WHEN last_name IS NOT NULL THEN ' ' || last_name ELSE '' END AS name
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
              AND date(s.sold_at) BETWEEN ? AND ?
            GROUP BY sss.staff_member_id`,
          [branchId, from, to],
        ),
        query<{ staff_member_id: string; total: number }>(
          `SELECT staff_member_id, ROUND(SUM(amount), 2) AS total
             FROM staff_advance
            WHERE branch_id = ? AND status = 'confirmed'
              AND date(advance_date) BETWEEN ? AND ?
              AND COALESCE(notes,'') NOT LIKE '${ADJUST_COMMISSION_MARK}%'
            GROUP BY staff_member_id`,
          [branchId, from, to],
        ),
      ]);
      const cMap = new Map(commissions.map((c) => [c.staff_member_id, c.total]));
      const aMap = new Map(advances.map((a) => [a.staff_member_id, a.total]));
      return staff.map((s) => {
        const commission_total = cMap.get(s.id) ?? 0;
        const advances_total = aMap.get(s.id) ?? 0;
        return {
          staff_member_id: s.id,
          staff_name: s.name,
          commission_total,
          advances_total,
          net_payable:
            Math.round((commission_total - advances_total) * 100) / 100,
        };
      });
    },
  });

  const rows = liq.data ?? [];
  const totals = rows.reduce(
    (acc, r) => ({
      c: acc.c + r.commission_total,
      a: acc.a + r.advances_total,
      n: acc.n + r.net_payable,
    }),
    { c: 0, a: 0, n: 0 },
  );
  const isCurrentWeek = weekBounds(new Date()).from === from;

  return (
    <Card gold>
      <CardHeader
        title="Liquidación de comisiones"
        subtitle="Comisiones − adelantos = neto a pagar"
        action={
          <div className="flex items-center gap-1">
            <button
              onClick={() => shiftWeek(-7)}
              title="Semana anterior"
              className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[9rem] text-center text-xs font-medium text-white/70">
              {dateShort(from)} – {dateShort(to)}
            </span>
            <button
              onClick={() => shiftWeek(7)}
              title="Semana siguiente"
              className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {!isCurrentWeek && (
              <Button size="sm" variant="ghost" onClick={() => setWeekRef(new Date())}>
                Hoy
              </Button>
            )}
          </div>
        }
      />

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-white/40">
                <th className="pb-2">Colaborador</th>
                <th className="pb-2 text-right">Comisiones</th>
                <th className="pb-2 text-right">Adelantos</th>
                <th className="pb-2 text-right">Neto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.staff_member_id}>
                  <td className="py-2 text-white">{r.staff_name}</td>
                  <td className="py-2 text-right text-white/70">
                    {money(r.commission_total)}
                  </td>
                  <td className="py-2 text-right text-danger">
                    {r.advances_total > 0 ? `−${money(r.advances_total)}` : money(0)}
                  </td>
                  <td className="py-2 text-right font-semibold text-gold-200">
                    {money(r.net_payable)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 text-sm font-semibold">
                <td className="pt-2 text-white/70">Total</td>
                <td className="pt-2 text-right text-white/70">{money(totals.c)}</td>
                <td className="pt-2 text-right text-danger">
                  {totals.a > 0 ? `−${money(totals.a)}` : money(0)}
                </td>
                <td className="pt-2 text-right text-gold-200">{money(totals.n)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="Sin colaboradores activos"
          description="Agregá colaboradores para ver su liquidación semanal."
        />
      )}
    </Card>
  );
}

interface CommissionBalanceRow {
  staff_member_id: string;
  staff_name: string;
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
      const today = todayISO();
      const [staff, accrued, advances, payments] = await Promise.all([
        query<{ id: string; name: string }>(
          `SELECT id,
                  first_name || CASE WHEN last_name IS NOT NULL THEN ' ' || last_name ELSE '' END AS name
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
              AND date(s.sold_at) <= ?
            GROUP BY sss.staff_member_id`,
          [branchId, today],
        ),
        // incluye ajustes (marca [Ajuste de comisión]) para el acumulado
        query<{ staff_member_id: string; total: number }>(
          `SELECT staff_member_id, ROUND(SUM(amount), 2) AS total
             FROM staff_advance
            WHERE branch_id = ? AND status = 'confirmed'
              AND date(advance_date) <= ?
            GROUP BY staff_member_id`,
          [branchId, today],
        ),
        // pagos de comisiones ya liquidados
        query<{ staff_member_id: string; total: number }>(
          `SELECT staff_member_id, ROUND(SUM(net_paid), 2) AS total
             FROM staff_payment
            WHERE branch_id = ? AND status = 'confirmed'
              AND date(paid_at) <= ?
            GROUP BY staff_member_id`,
          [branchId, today],
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
                <tr key={r.staff_member_id}>
                  <td className="py-2 text-white">{r.staff_name}</td>
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
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="Pagar / liquidar comisiones"
                        disabled={r.pending <= 0.001}
                        onClick={() => setPay(r)}
                        className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <HandCoins className="h-4 w-4" />
                      </button>
                      <button
                        title="Cuadrar saldo"
                        onClick={() => setAdjust(r)}
                        className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-gold-300"
                      >
                        <Scale className="h-4 w-4" />
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
  const [real, setReal] = useState(String(row.pending.toFixed(2)));

  const methods = useQuery({
    queryKey: ['payment-methods', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });

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
      qc.invalidateQueries({ queryKey: ['commission-balance'] });
      onClose();
    },
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

  const [amount, setAmount] = useState(String(row.pending.toFixed(2)));
  const [account, setAccount] = useState(''); // 'cash' | bank id

  const methods = useQuery({
    queryKey: ['payment-methods', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });
  const banks = useQuery({
    queryKey: ['bank-accounts', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<BankAccount>(
        'SELECT * FROM bank_account WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });
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
      const cashMethod = methods.data?.find((m) => m.method_type === 'cash');
      const transferMethod = methods.data?.find(
        (m) => m.method_type === 'transfer',
      );
      const method = isCash ? cashMethod : transferMethod;
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : account;

      // Categoría de egreso para pagos a personal (fallback: primera activa).
      const cat = await queryOne<{ id: string }>(
        `SELECT id FROM expense_category
          WHERE organization_id = ? AND active = 1
            AND (name LIKE '%personal%' OR name LIKE '%sueldo%' OR name LIKE '%comisi%' OR name LIKE '%nómina%')
          ORDER BY name LIMIT 1`,
        [orgId],
      );
      const fallbackCat = cat
        ? null
        : await queryOne<{ id: string }>(
            'SELECT id FROM expense_category WHERE organization_id = ? AND active = 1 ORDER BY name LIMIT 1',
            [orgId],
          );
      const categoryId = cat?.id ?? fallbackCat?.id;
      if (!categoryId)
        throw new Error('No hay una categoría de egreso configurada.');

      const label = `Pago de comisiones · ${row.staff_name}`;
      const paymentId = genId();
      const expenseId = genId();
      const now = new Date().toISOString();

      const stmts: { sql: string; args: (string | number | null)[] }[] = [
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
        // Egreso real (afecta cuenta/caja y P&L).
        {
          sql: `INSERT INTO expense
                  (id, organization_id, branch_id, expense_category_id, payment_method_id,
                   bank_account_id, expense_date, description, amount, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            expenseId,
            orgId,
            branchId,
            categoryId,
            method.id,
            bankId,
            todayISO(),
            label,
            value,
            userId,
          ],
        },
      ];

      if (isCash) {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, expense_id, description, created_by)
                VALUES (?, ?, ?, 'expense', 'out', ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            sessionId,
            branchId,
            value,
            now,
            expenseId,
            label,
            userId,
          ],
        });
      }

      await batch(stmts);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-balance'] });
      qc.invalidateQueries({ queryKey: ['fin-accounts'] });
      qc.invalidateQueries({ queryKey: ['fin-summary'] });
      qc.invalidateQueries({ queryKey: ['fin-exp7'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['cash-expected'] });
      onClose();
    },
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
        <Select
          label="Pagar desde"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          <option value="cash">Caja (efectivo)</option>
          {banks.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
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

  const methods = useQuery({
    queryKey: ['payment-methods', orgId],
    enabled: open && !!orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });

  const banks = useQuery({
    queryKey: ['bank-accounts', orgId],
    enabled: open && !!orgId,
    queryFn: () =>
      query<BankAccount>(
        'SELECT * FROM bank_account WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });

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

  const save = useMutation({
    mutationFn: async () => {
      const cashMethod = methods.data?.find((m) => m.method_type === 'cash');
      const transferMethod = methods.data?.find(
        (m) => m.method_type === 'transfer',
      );
      const method = isCash ? cashMethod : transferMethod;
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : account;

      // Categoría de egreso para pagos a personal (fallback: primera activa).
      const cat = await queryOne<{ id: string }>(
        `SELECT id FROM expense_category
          WHERE organization_id = ? AND active = 1
            AND (name LIKE '%personal%' OR name LIKE '%sueldo%' OR name LIKE '%nómina%')
          ORDER BY name LIMIT 1`,
        [orgId],
      );
      const fallbackCat = cat
        ? null
        : await queryOne<{ id: string }>(
            'SELECT id FROM expense_category WHERE organization_id = ? AND active = 1 ORDER BY name LIMIT 1',
            [orgId],
          );
      const categoryId = cat?.id ?? fallbackCat?.id;
      if (!categoryId)
        throw new Error('No hay una categoría de egreso configurada.');

      const person = staff.data?.find((s) => s.id === staffId);
      const label = `Adelanto de sueldo · ${
        person ? fullName(person.first_name, person.last_name) : ''
      }`.trim();
      const advanceId = genId();
      const expenseId = genId();
      const now = new Date().toISOString();

      const stmts: { sql: string; args: (string | number | null)[] }[] = [
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
        // Se registra también como egreso automáticamente.
        {
          sql: `INSERT INTO expense
                  (id, organization_id, branch_id, expense_category_id, payment_method_id,
                   bank_account_id, expense_date, description, amount, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            expenseId,
            orgId,
            branchId,
            categoryId,
            method.id,
            bankId,
            todayISO(),
            label,
            Number(amount),
            userId,
          ],
        },
      ];

      // En efectivo, además descuenta de la caja física.
      if (isCash) {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, expense_id, description, created_by)
                VALUES (?, ?, ?, 'expense', 'out', ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            sessionId,
            branchId,
            Number(amount),
            now,
            expenseId,
            label,
            userId,
          ],
        });
      }

      await batch(stmts);
    },
    onSuccess: () => {
      setStaffId('');
      setAmount('');
      setAccount('');
      qc.invalidateQueries({ queryKey: ['payable-summary'] });
      qc.invalidateQueries({ queryKey: ['fin-accounts'] });
      qc.invalidateQueries({ queryKey: ['fin-summary'] });
      qc.invalidateQueries({ queryKey: ['fin-exp7'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['cash-expected'] });
      onClose();
    },
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
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select
          label="Cuenta"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          <option value="cash">Caja (efectivo)</option>
          {banks.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
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
