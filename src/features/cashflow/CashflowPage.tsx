import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Lock,
  Unlock,
  Plus,
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Wallet,
  Landmark,
  Check,
  Trash2,
} from 'lucide-react';
import { query, queryOne, execute, batch } from '@/lib/db';
import { qk } from '@/lib/queryClient';
import { genId, money, timeShort, dateShort, todayISO } from '@/lib/format';
import { useSession, useBranchId, useOrgId } from '@/store/session';
import { cn } from '@/lib/cn';
import {
  Button,
  Card,
  CardHeader,
  Input,
  Select,
  Modal,
  EmptyState,
  Badge,
} from '@/components/ui';
import { CollectSection } from './CollectSection';
import type {
  AccountKind,
  BankAccount,
  CashDirection,
  CashRegister,
  CashSession,
  DebtCredit,
  DebtCreditKind,
  Expense,
  ExpenseCategory,
  PaymentMethod,
} from '@/types';

/* ─────────────────────── helpers de periodo / invalidación ─────────────────────── */

const ym = (d: Date) => d.toISOString().slice(0, 10).slice(0, 7);
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('es-EC', { month: 'long' });

/** Invalida todas las queries de finanzas de una (coincidencia por prefijo). */
function useInvalidateFinance() {
  const qc = useQueryClient();
  const branchId = useBranchId();
  return () => {
    for (const key of [
      ['fin-accounts'],
      ['fin-summary'],
      ['fin-exp7'],
      ['fin-debts'],
      ['transactions'],
      ['cash-expected'],
    ]) {
      qc.invalidateQueries({ queryKey: key });
    }
    qc.invalidateQueries({ queryKey: qk.cashSession(branchId) });
    qc.invalidateQueries({ queryKey: qk.sales(branchId) });
  };
}

type TabKey = 'resumen' | 'transacciones' | 'caja' | 'bancos' | 'deudas';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'transacciones', label: 'Transacciones' },
  { key: 'caja', label: 'Caja' },
  { key: 'bancos', label: 'Cuentas bancarias' },
  { key: 'deudas', label: 'Deudas · Créditos' },
];

/* ───────────────────────────────── Página ───────────────────────────────── */

export function CashflowPage() {
  const branchId = useBranchId();
  const orgId = useOrgId();
  const user = useSession((s) => s.user);
  const setCashSession = useSession((s) => s.setCashSession);
  const [tab, setTab] = useState<TabKey>('resumen');

  const session = useQuery({
    queryKey: qk.cashSession(branchId),
    enabled: !!branchId,
    queryFn: async () => {
      const s = await queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'open'
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      );
      setCashSession(s);
      return s;
    },
  });

  const open = session.data ?? null;
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const ctx = {
    branchId,
    orgId,
    userId: user?.id ?? null,
    sessionId: open?.id ?? null,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold text-white">Finanzas</h1>

      {/* Submenú */}
      <div className="flex flex-wrap gap-1 rounded-xl bg-white/5 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
              tab === t.key
                ? 'bg-gold-400 text-ink-950 shadow-gold-glow'
                : 'text-white/50 hover:text-white',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && <ResumenTab ctx={ctx} />}
      {tab === 'transacciones' && <TransactionsSection branchId={branchId} />}
      {tab === 'caja' && (
        <CajaTab session={open} loading={session.isLoading} ctx={ctx} />
      )}
      {tab === 'bancos' && <BankAccountsTab ctx={ctx} isAdmin={isAdmin} />}
      {tab === 'deudas' && <DebtsTab ctx={ctx} />}
    </div>
  );
}

/* ────────────────────────── contexto compartido ────────────────────────── */

interface Ctx {
  branchId: string;
  orgId: string;
  userId: string | null;
  sessionId: string | null;
}

/* ───────────────────────────────── Resumen ──────────────────────────────── */

function ResumenTab({ ctx }: { ctx: Ctx }) {
  const [modal, setModal] = useState<null | 'income' | 'expense' | 'transfer'>(
    null,
  );

  return (
    <div className="space-y-6">
      {/* Botones principales */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Button className="w-full" onClick={() => setModal('income')}>
          <ArrowDownLeft className="h-4 w-4" /> Otro ingreso
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setModal('expense')}
        >
          <ArrowUpRight className="h-4 w-4" /> Gasto
        </Button>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setModal('transfer')}
        >
          <ArrowLeftRight className="h-4 w-4" /> Transferir dinero
        </Button>
      </div>

      <SummaryCard branchId={ctx.branchId} />

      <div className="grid gap-6 lg:grid-cols-2">
        <AccountsCard ctx={ctx} />
        <ExpensesLast7Card branchId={ctx.branchId} />
      </div>

      <BalanceChartCard branchId={ctx.branchId} />

      <TransactionsSection branchId={ctx.branchId} />

      {modal === 'income' && (
        <IncomeModal ctx={ctx} onClose={() => setModal(null)} />
      )}
      {modal === 'expense' && (
        <ExpenseModal ctx={ctx} onClose={() => setModal(null)} />
      )}
      {modal === 'transfer' && (
        <TransferModal ctx={ctx} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

/** Resumen mes anterior vs mes actual: ingresos, egresos, total. */
function SummaryCard({ branchId }: { branchId: string }) {
  const now = new Date();
  const curr = ym(now);
  const prev = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const data = useQuery({
    queryKey: ['fin-summary', branchId, curr],
    enabled: !!branchId,
    queryFn: async () => {
      // Ventas cobradas (pago atado a venta) vs otros ingresos (sin venta).
      const inc = await query<{ m: string; sales: number; other: number }>(
        `SELECT substr(paid_at,1,7) AS m,
                SUM(CASE WHEN sale_id IS NOT NULL THEN amount ELSE 0 END) AS sales,
                SUM(CASE WHEN sale_id IS NULL THEN amount ELSE 0 END) AS other
           FROM payment
          WHERE branch_id = ? AND status = 'confirmed'
            AND substr(paid_at,1,7) IN (?, ?)
          GROUP BY 1`,
        [branchId, prev, curr],
      );
      const exp = await query<{ m: string; s: number }>(
        `SELECT substr(expense_date,1,7) AS m, SUM(amount) AS s
           FROM expense
          WHERE branch_id = ? AND status <> 'voided'
            AND substr(expense_date,1,7) IN (?, ?)
          GROUP BY 1`,
        [branchId, prev, curr],
      );
      const pickInc = (m: string) => inc.find((r) => r.m === m);
      const pickExp = (m: string) => exp.find((r) => r.m === m)?.s ?? 0;
      return {
        prev: {
          sales: pickInc(prev)?.sales ?? 0,
          other: pickInc(prev)?.other ?? 0,
          expense: pickExp(prev),
        },
        curr: {
          sales: pickInc(curr)?.sales ?? 0,
          other: pickInc(curr)?.other ?? 0,
          expense: pickExp(curr),
        },
      };
    },
  });

  const blocks = [
    { label: monthLabel(prev), d: data.data?.prev },
    { label: monthLabel(curr), d: data.data?.curr, gold: true },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {blocks.map((b) => {
        const sales = b.d?.sales ?? 0;
        const other = b.d?.other ?? 0;
        const expense = b.d?.expense ?? 0;
        return (
          <Card key={b.label} gold={b.gold}>
            <p className="mb-3 text-sm font-medium capitalize text-white">
              {b.label}
            </p>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Ventas" value={money(sales)} tone="success" />
              <Metric label="Egresos" value={money(expense)} tone="danger" />
              <Metric label="Neto" value={money(sales + other - expense)} gold />
            </div>
            {other > 0 && (
              <p className="mt-3 text-xs text-white/40">
                + {money(other)} en otros ingresos (no ventas)
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** Cuentas: caja física + cuentas bancarias con saldo actual. */
function AccountsCard({ ctx }: { ctx: Ctx }) {
  const accounts = useAccounts(ctx);

  return (
    <Card>
      <CardHeader title="Cuentas" subtitle="Saldo actual" />
      <ul className="divide-y divide-white/5">
        <li className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gold/10 text-gold-300 ring-1 ring-gold/20">
              <Wallet className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm text-white">Caja</p>
              <p className="text-xs text-white/40">
                {accounts.data?.cashOpen ? 'Sesión abierta' : 'Caja cerrada'}
              </p>
            </div>
          </div>
          <span className="text-sm font-semibold text-white">
            {money(accounts.data?.cash ?? 0)}
          </span>
        </li>
        {accounts.data?.banks.map((b) => (
          <li key={b.id} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white/60 ring-1 ring-white/10">
                <Landmark className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm text-white">{b.name}</p>
                <p className="text-xs text-white/40">{b.bank_name ?? 'Banco'}</p>
              </div>
            </div>
            <span className="text-sm font-semibold text-white">
              {money(b.balance)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Gastos de los últimos 7 días (efectivo + transferencias), con scroll. */
function ExpensesLast7Card({ branchId }: { branchId: string }) {
  const from = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  }, []);

  const expenses = useQuery({
    queryKey: ['fin-exp7', branchId, from],
    enabled: !!branchId,
    queryFn: () =>
      query<Expense & { category_name: string; method_type: string }>(
        `SELECT e.*, ec.name AS category_name, pm.method_type
           FROM expense e
           JOIN expense_category ec ON ec.id = e.expense_category_id
           JOIN payment_method pm ON pm.id = e.payment_method_id
          WHERE e.branch_id = ? AND e.expense_date >= ? AND e.status <> 'voided'
          ORDER BY e.expense_date DESC, e.created_at DESC`,
        [branchId, from],
      ),
  });

  const rows = expenses.data ?? [];
  const total = rows.reduce((a, r) => a + r.amount, 0);

  return (
    <Card>
      <CardHeader
        title="Gastos últimos 7 días"
        subtitle={`Efectivo y transferencias · ${money(total)}`}
      />
      {rows.length > 0 ? (
        <ul className="max-h-72 divide-y divide-white/5 overflow-y-auto pr-1">
          {rows.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm text-white">{e.description}</p>
                <p className="text-xs text-white/40">
                  {dateShort(e.expense_date)} · {e.category_name} ·{' '}
                  {e.method_type === 'cash' ? 'Efectivo' : 'Transferencia'}
                </p>
              </div>
              <span className="text-sm font-medium text-danger">
                −{money(e.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Receipt} title="Sin gastos en los últimos 7 días" />
      )}
    </Card>
  );
}

/** Gráfico de balance (ingresos − egresos) de los últimos 6 meses. */
function BalanceChartCard({ branchId }: { branchId: string }) {
  const months = useMemo(() => {
    const now = new Date();
    const arr: string[] = [];
    for (let i = 5; i >= 0; i--) {
      arr.push(ym(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }
    return arr;
  }, []);

  const data = useQuery({
    queryKey: ['fin-summary-chart', branchId, months[0]],
    enabled: !!branchId,
    queryFn: async () => {
      const min = months[0];
      const inc = await query<{ m: string; s: number }>(
        `SELECT substr(paid_at,1,7) AS m, SUM(amount) AS s
           FROM payment
          WHERE branch_id = ? AND status = 'confirmed' AND substr(paid_at,1,7) >= ?
          GROUP BY 1`,
        [branchId, min],
      );
      const exp = await query<{ m: string; s: number }>(
        `SELECT substr(expense_date,1,7) AS m, SUM(amount) AS s
           FROM expense
          WHERE branch_id = ? AND status <> 'voided' AND substr(expense_date,1,7) >= ?
          GROUP BY 1`,
        [branchId, min],
      );
      return months.map((m) => {
        const income = inc.find((r) => r.m === m)?.s ?? 0;
        const expense = exp.find((r) => r.m === m)?.s ?? 0;
        return {
          label: monthLabel(m).slice(0, 3),
          net: income - expense,
        };
      });
    },
  });

  const rows = data.data ?? [];
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));

  return (
    <Card>
      <CardHeader title="Balance histórico" subtitle="Ingresos − egresos por mes" />
      {rows.every((r) => r.net === 0) ? (
        <EmptyState icon={Receipt} title="Sin movimientos para graficar" />
      ) : (
        <div className="flex items-stretch gap-3" style={{ height: 180 }}>
          {rows.map((r) => {
            const h = Math.max(2, (Math.abs(r.net) / max) * 70);
            const positive = r.net >= 0;
            return (
              <div
                key={r.label}
                className="flex flex-1 flex-col items-center justify-center"
              >
                {/* mitad superior (positivos) */}
                <div className="flex w-full flex-1 items-end justify-center">
                  {positive && (
                    <div
                      className="w-full rounded-t-lg bg-gradient-to-t from-emerald-500/50 to-emerald-300"
                      style={{ height: `${h}%` }}
                    />
                  )}
                </div>
                <div className="my-1 h-px w-full bg-white/10" />
                {/* mitad inferior (negativos) */}
                <div className="flex w-full flex-1 items-start justify-center">
                  {!positive && (
                    <div
                      className="w-full rounded-b-lg bg-gradient-to-b from-rose-500/50 to-rose-300"
                      style={{ height: `${h}%` }}
                    />
                  )}
                </div>
                <span className="mt-1 text-[10px] uppercase text-white/40">
                  {r.label}
                </span>
                <span
                  className={cn(
                    'text-[10px] font-medium',
                    positive ? 'text-emerald-300' : 'text-rose-300',
                  )}
                >
                  {money(r.net)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ─────────────────── hook de cuentas (caja + bancos) ─────────────────── */

function useAccounts(ctx: Ctx) {
  return useQuery({
    queryKey: ['fin-accounts', ctx.branchId, ctx.orgId, ctx.sessionId],
    enabled: !!ctx.branchId && !!ctx.orgId,
    queryFn: async () => {
      let cash = 0;
      if (ctx.sessionId) {
        const s = await queryOne<{ opening: number; net: number }>(
          `SELECT cs.opening_cash AS opening,
                  COALESCE((SELECT SUM(CASE WHEN direction='in' THEN amount ELSE -amount END)
                              FROM cash_movement WHERE cash_session_id = cs.id),0) AS net
             FROM cash_session cs WHERE cs.id = ?`,
          [ctx.sessionId],
        );
        cash = (s?.opening ?? 0) + (s?.net ?? 0);
      }
      const banks = await query<BankAccount & { balance: number }>(
        `SELECT ba.id, ba.name, ba.bank_name,
                COALESCE((SELECT SUM(p.amount) FROM payment p
                           WHERE p.bank_account_id = ba.id AND p.status = 'confirmed'),0)
              - COALESCE((SELECT SUM(e.amount) FROM expense e
                           WHERE e.bank_account_id = ba.id AND e.status <> 'voided'),0)
              + COALESCE((SELECT SUM(t.amount) FROM account_transfer t
                           WHERE t.to_kind = 'bank' AND t.to_bank_account_id = ba.id),0)
              - COALESCE((SELECT SUM(t.amount) FROM account_transfer t
                           WHERE t.from_kind = 'bank' AND t.from_bank_account_id = ba.id),0)
                AS balance
           FROM bank_account ba
          WHERE ba.organization_id = ? AND ba.active = 1
          ORDER BY ba.name`,
        [ctx.orgId],
      );
      return { cash, cashOpen: !!ctx.sessionId, banks };
    },
  });
}

/* ─────────────────── métodos de pago (cash / transfer) ─────────────────── */

function usePaymentMethods(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['payment-methods', orgId],
    enabled: enabled && !!orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });
}

function useBankAccounts(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['bank-accounts', orgId],
    enabled: enabled && !!orgId,
    queryFn: () =>
      query<BankAccount>(
        'SELECT * FROM bank_account WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });
}

/* ───────────────────────────── Modal: Ingreso ───────────────────────────── */

/**
 * Motivos válidos de ingreso que NO son una venta. El cobro de un servicio/
 * producto NO va acá: se registra como venta (Nueva venta / atención de cita) y
 * se cobra en "Cobros". Esto evita ingresos sueltos sin trazabilidad que
 * inflarían lo recibido sin una venta detrás.
 */
const INCOME_REASONS: { value: string; label: string }[] = [
  { value: 'Seña / Anticipo', label: 'Seña / Anticipo de cita' },
  { value: 'Aporte de capital', label: 'Aporte de capital' },
  { value: 'Préstamo recibido', label: 'Préstamo recibido' },
  { value: 'Ajuste de caja', label: 'Ajuste de caja' },
  { value: 'Otro', label: 'Otro' },
];

function IncomeModal({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const invalidate = useInvalidateFinance();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [dest, setDest] = useState(''); // 'cash' | bank account id

  const methods = usePaymentMethods(ctx.orgId, true);
  const banks = useBankAccounts(ctx.orgId, true);

  const cashMethod = methods.data?.find((m) => m.method_type === 'cash');
  const transferMethod = methods.data?.find((m) => m.method_type === 'transfer');
  const isCash = dest === 'cash';
  const needsSession = isCash && !ctx.sessionId;

  // Todo ingreso manual queda etiquetado con su motivo + detalle (nunca un monto
  // suelto). Se marca "[Otro ingreso]" para distinguirlo de un cobro de venta.
  const label = `[Otro ingreso] ${reason}${description ? ` · ${description}` : ''}`;

  const save = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      const paymentId = genId();
      const method = isCash ? cashMethod : transferMethod;
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : dest;

      const stmts: { sql: string; args: (string | number | null)[] }[] = [
        {
          sql: `INSERT INTO payment
                  (id, organization_id, branch_id, sale_id, payment_method_id,
                   bank_account_id, paid_at, amount, status, reference)
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            paymentId,
            ctx.orgId,
            ctx.branchId,
            method.id,
            bankId,
            now,
            Number(amount),
            label,
          ],
        },
      ];

      if (isCash) {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, payment_id, description, created_by)
                VALUES (?, ?, ?, 'cash_in', 'in', ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            ctx.sessionId,
            ctx.branchId,
            Number(amount),
            now,
            paymentId,
            label,
            ctx.userId,
          ],
        });
      }

      await batch(stmts);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title="Otro ingreso">
      <div className="space-y-4">
        <p className="rounded-lg bg-white/5 p-3 text-xs text-white/50">
          Usá esto solo para ingresos que <b>no</b> son una venta (seña, aporte,
          préstamo, ajuste). El cobro de un servicio o producto se registra como
          venta y se cobra en «Cobros».
        </p>
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select
          label="Motivo"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          {INCOME_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        <Select
          label="Cuenta destino"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          <option value="cash">Caja (efectivo)</option>
          {banks.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Input
          label="Detalle"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ej. anticipo cita de María, aporte socio…"
        />
        {needsSession && (
          <p className="text-xs text-danger">
            Para un ingreso en efectivo necesitás abrir la caja primero.
          </p>
        )}
        <Button
          className="w-full"
          disabled={
            !amount ||
            Number(amount) <= 0 ||
            !reason ||
            !dest ||
            needsSession
          }
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Guardar ingreso
        </Button>
      </div>
    </Modal>
  );
}

/* ───────────────────────────── Modal: Gasto ───────────────────────────── */

function ExpenseModal({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const invalidate = useInvalidateFinance();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [source, setSource] = useState(''); // 'cash' | bank account id

  const categories = useQuery({
    queryKey: ['expense-categories', ctx.orgId],
    enabled: !!ctx.orgId,
    queryFn: () =>
      query<ExpenseCategory>(
        'SELECT * FROM expense_category WHERE organization_id = ? AND active = 1 ORDER BY name',
        [ctx.orgId],
      ),
  });
  const methods = usePaymentMethods(ctx.orgId, true);
  const banks = useBankAccounts(ctx.orgId, true);

  const cashMethod = methods.data?.find((m) => m.method_type === 'cash');
  const transferMethod = methods.data?.find((m) => m.method_type === 'transfer');
  const isCash = source === 'cash';
  const needsSession = isCash && !ctx.sessionId;

  const save = useMutation({
    mutationFn: async () => {
      const method = isCash ? cashMethod : transferMethod;
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : source;
      const expenseId = genId();
      const now = new Date().toISOString();

      const stmts: { sql: string; args: (string | number | null)[] }[] = [
        {
          sql: `INSERT INTO expense
                  (id, organization_id, branch_id, expense_category_id, payment_method_id,
                   bank_account_id, expense_date, description, amount, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            expenseId,
            ctx.orgId,
            ctx.branchId,
            categoryId,
            method.id,
            bankId,
            todayISO(),
            description,
            Number(amount),
            ctx.userId,
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
            ctx.sessionId,
            ctx.branchId,
            Number(amount),
            now,
            expenseId,
            description,
            ctx.userId,
          ],
        });
      }

      await batch(stmts);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title="Registrar gasto">
      <div className="space-y-4">
        <Input
          label="Descripción"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Insumos, servicios básicos…"
        />
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select
          label="Categoría"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          label="Pagar desde"
          value={source}
          onChange={(e) => setSource(e.target.value)}
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
            Para un gasto en efectivo necesitás abrir la caja primero.
          </p>
        )}
        <Button
          className="w-full"
          disabled={
            !description ||
            !amount ||
            Number(amount) <= 0 ||
            !categoryId ||
            !source ||
            needsSession
          }
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Guardar gasto
        </Button>
      </div>
    </Modal>
  );
}

/* ─────────────────────────── Modal: Transferir ─────────────────────────── */

function TransferModal({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const invalidate = useInvalidateFinance();
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(''); // 'cash' | bank id
  const [to, setTo] = useState('');
  const [description, setDescription] = useState('');

  const banks = useBankAccounts(ctx.orgId, true);

  const involvesCash = from === 'cash' || to === 'cash';
  const needsSession = involvesCash && !ctx.sessionId;
  const sameAccount = from && to && from === to;

  const save = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      const fromKind: AccountKind = from === 'cash' ? 'cash' : 'bank';
      const toKind: AccountKind = to === 'cash' ? 'cash' : 'bank';

      const stmts: { sql: string; args: (string | number | null)[] }[] = [
        {
          sql: `INSERT INTO account_transfer
                  (id, organization_id, branch_id, transfer_date, amount,
                   from_kind, from_bank_account_id, to_kind, to_bank_account_id,
                   cash_session_id, description, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            ctx.orgId,
            ctx.branchId,
            todayISO(),
            Number(amount),
            fromKind,
            fromKind === 'bank' ? from : null,
            toKind,
            toKind === 'bank' ? to : null,
            involvesCash ? ctx.sessionId : null,
            description || null,
            ctx.userId,
            now,
          ],
        },
      ];

      // El lado en efectivo mueve la caja física.
      if (fromKind === 'cash') {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, description, created_by)
                VALUES (?, ?, ?, 'cash_out', 'out', ?, ?, ?, ?)`,
          args: [
            genId(),
            ctx.sessionId,
            ctx.branchId,
            Number(amount),
            now,
            description || 'Transferencia a banco',
            ctx.userId,
          ],
        });
      }
      if (toKind === 'cash') {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, description, created_by)
                VALUES (?, ?, ?, 'cash_in', 'in', ?, ?, ?, ?)`,
          args: [
            genId(),
            ctx.sessionId,
            ctx.branchId,
            Number(amount),
            now,
            description || 'Transferencia desde banco',
            ctx.userId,
          ],
        });
      }

      await batch(stmts);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const options = (
    <>
      <option value="">Seleccionar…</option>
      <option value="cash">Caja (efectivo)</option>
      {banks.data?.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </>
  );

  return (
    <Modal open onClose={onClose} title="Transferir dinero">
      <div className="space-y-4">
        <Select label="Desde" value={from} onChange={(e) => setFrom(e.target.value)}>
          {options}
        </Select>
        <Select label="Hacia" value={to} onChange={(e) => setTo(e.target.value)}>
          {options}
        </Select>
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          label="Descripción (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {sameAccount && (
          <p className="text-xs text-danger">
            El origen y el destino deben ser distintos.
          </p>
        )}
        {needsSession && (
          <p className="text-xs text-danger">
            Una transferencia con la caja necesita la caja abierta.
          </p>
        )}
        <Button
          className="w-full"
          disabled={
            !amount ||
            Number(amount) <= 0 ||
            !from ||
            !to ||
            !!sameAccount ||
            needsSession
          }
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Transferir
        </Button>
      </div>
    </Modal>
  );
}

/* ───────────────────────────────── Caja ───────────────────────────────── */

function CajaTab({
  session,
  loading,
  ctx,
}: {
  session: CashSession | null;
  loading: boolean;
  ctx: Ctx;
}) {
  const qc = useQueryClient();
  const setCashSession = useSession((s) => s.setCashSession);
  const invalidate = useInvalidateFinance();

  if (loading) return null;

  if (!session) {
    return (
      <OpenForm
        branchId={ctx.branchId}
        userId={ctx.userId}
        onOpened={() =>
          qc.invalidateQueries({ queryKey: qk.cashSession(ctx.branchId) })
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <OpenSessionCard
        session={session}
        onClosed={() => {
          setCashSession(null);
          invalidate();
        }}
      />
      <CollectSection sessionId={session.id} userId={ctx.userId} />
    </div>
  );
}

function OpenForm({
  branchId,
  userId,
  onOpened,
}: {
  branchId: string;
  userId: string | null;
  onOpened: () => void;
}) {
  const [opening, setOpening] = useState('0');

  const register = useQuery({
    queryKey: ['register', branchId],
    enabled: !!branchId,
    queryFn: () =>
      queryOne<CashRegister>(
        'SELECT * FROM cash_register WHERE branch_id = ? AND active = 1 ORDER BY name LIMIT 1',
        [branchId],
      ),
  });

  const mut = useMutation({
    mutationFn: async () => {
      const registerId = register.data?.id;
      if (!registerId) throw new Error('La sucursal no tiene caja registradora.');
      await execute(
        `INSERT INTO cash_session (id, cash_register_id, opened_by, opened_at, opening_cash, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
        [genId(), registerId, userId, new Date().toISOString(), Number(opening)],
      );
    },
    onSuccess: onOpened,
  });

  if (register.isLoading) return null;

  if (!register.data) {
    return (
      <Card>
        <CardHeader title="Abrir caja" subtitle="Iniciá la sesión del día" />
        <EmptyState
          icon={Receipt}
          title="Sin caja registradora"
          description="Esta sucursal no tiene una caja registradora configurada. Creá una en Configuración."
        />
      </Card>
    );
  }

  return (
    <Card gold>
      <CardHeader title="Abrir caja" subtitle={`Caja: ${register.data.name}`} />
      <div className="space-y-4">
        <Input
          label="Efectivo de apertura"
          type="number"
          min="0"
          step="0.01"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
        />
        <Button
          className="w-full"
          size="lg"
          loading={mut.isPending}
          onClick={() => mut.mutate()}
        >
          <Unlock className="h-4 w-4" /> Abrir caja
        </Button>
      </div>
    </Card>
  );
}

function OpenSessionCard({
  session,
  onClosed,
}: {
  session: CashSession;
  onClosed: () => void;
}) {
  const [counted, setCounted] = useState('');
  const [closing, setClosing] = useState(false);

  const expected = useQuery({
    queryKey: ['cash-expected', session.id],
    queryFn: async () => {
      const row = await queryOne<{ net: number }>(
        `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS net
           FROM cash_movement WHERE cash_session_id = ?`,
        [session.id],
      );
      return session.opening_cash + (row?.net ?? 0);
    },
  });

  const close = useMutation({
    mutationFn: async () => {
      const exp = expected.data ?? session.opening_cash;
      const cnt = Number(counted);
      await execute(
        `UPDATE cash_session
            SET status='closed', closed_at=?, expected_cash=?, counted_cash=?, difference=?
          WHERE id = ?`,
        [new Date().toISOString(), exp, cnt, cnt - exp, session.id],
      );
    },
    onSuccess: onClosed,
  });

  const exp = expected.data ?? session.opening_cash;
  const diff = counted ? Number(counted) - exp : null;

  return (
    <Card>
      <CardHeader
        title="Sesión de caja abierta"
        subtitle={`Abierta ${timeShort(session.opened_at)}`}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Metric label="Apertura" value={money(session.opening_cash)} />
        <Metric label="Esperado" value={money(exp)} gold />
        {diff != null && (
          <Metric
            label="Diferencia"
            value={money(diff)}
            tone={diff < 0 ? 'danger' : 'success'}
          />
        )}
      </div>

      {!closing ? (
        <Button
          variant="outline"
          className="mt-5 w-full"
          onClick={() => setClosing(true)}
        >
          <Lock className="h-4 w-4" /> Cerrar caja
        </Button>
      ) : (
        <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
          <Input
            label="Efectivo contado (físico)"
            type="number"
            min="0"
            step="0.01"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setClosing(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={!counted}
              loading={close.isPending}
              onClick={() => close.mutate()}
            >
              Confirmar cierre
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────── Cuentas bancarias ─────────────────────────── */

function BankAccountsTab({ ctx, isAdmin }: { ctx: Ctx; isAdmin: boolean }) {
  const accounts = useAccounts(ctx);

  return (
    <Card>
      <CardHeader
        title="Cuentas bancarias"
        subtitle="Saldo calculado a partir de cobros, gastos y transferencias"
      />
      {accounts.data && accounts.data.banks.length > 0 ? (
        <ul className="divide-y divide-white/5">
          {accounts.data.banks.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white/60 ring-1 ring-white/10">
                  <Landmark className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm text-white">{b.name}</p>
                  <p className="text-xs text-white/40">{b.bank_name ?? 'Banco'}</p>
                </div>
              </div>
              <span className="text-sm font-semibold text-white">
                {money(b.balance)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Landmark}
          title="Sin cuentas bancarias"
          description={
            isAdmin
              ? 'Agregá cuentas en Configuración → Cuentas bancarias.'
              : 'Todavía no hay cuentas bancarias configuradas.'
          }
        />
      )}
    </Card>
  );
}

/* ─────────────────────────── Deudas · Créditos ─────────────────────────── */

function DebtsTab({ ctx }: { ctx: Ctx }) {
  const [modal, setModal] = useState(false);
  const invalidate = useInvalidateFinance();

  const items = useQuery({
    queryKey: ['fin-debts', ctx.branchId],
    enabled: !!ctx.branchId,
    queryFn: () =>
      query<DebtCredit>(
        `SELECT * FROM debt_credit
          WHERE branch_id = ? AND status <> 'voided'
          ORDER BY status = 'settled', due_date IS NULL, due_date`,
        [ctx.branchId],
      ),
  });

  const rows = items.data ?? [];
  const debts = rows.filter((r) => r.kind === 'debt');
  const credits = rows.filter((r) => r.kind === 'credit');
  const pend = (list: DebtCredit[]) =>
    list
      .filter((r) => r.status === 'open')
      .reduce((a, r) => a + (r.amount - r.paid_amount), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <Metric label="Por pagar (deudas)" value={money(pend(debts))} tone="danger" />
        </Card>
        <Card>
          <Metric label="Por cobrar (créditos)" value={money(pend(credits))} tone="success" />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Deudas y créditos"
          subtitle="Cuentas por pagar y por cobrar"
          action={
            <Button size="sm" onClick={() => setModal(true)}>
              <Plus className="h-4 w-4" /> Nuevo
            </Button>
          }
        />
        {rows.length > 0 ? (
          <ul className="divide-y divide-white/5">
            {rows.map((r) => (
              <DebtRow key={r.id} item={r} onChanged={invalidate} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={Receipt} title="Sin deudas ni créditos" />
        )}
      </Card>

      {modal && (
        <DebtModal
          ctx={ctx}
          onClose={() => setModal(false)}
          onSaved={() => {
            invalidate();
            setModal(false);
          }}
        />
      )}
    </div>
  );
}

function DebtRow({
  item,
  onChanged,
}: {
  item: DebtCredit;
  onChanged: () => void;
}) {
  const pending = item.amount - item.paid_amount;
  const isDebt = item.kind === 'debt';

  const settle = useMutation({
    mutationFn: () =>
      execute(
        `UPDATE debt_credit
            SET status='settled', paid_amount=amount, updated_at=?
          WHERE id = ?`,
        [new Date().toISOString(), item.id],
      ),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () =>
      execute(
        `UPDATE debt_credit SET status='voided', updated_at=? WHERE id = ?`,
        [new Date().toISOString(), item.id],
      ),
    onSuccess: onChanged,
  });

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge tone={isDebt ? 'danger' : 'success'}>
            {isDebt ? 'Por pagar' : 'Por cobrar'}
          </Badge>
          <p className="truncate text-sm text-white">{item.counterparty}</p>
        </div>
        <p className="text-xs text-white/40">
          {item.description ? `${item.description} · ` : ''}
          {item.due_date ? `Vence ${dateShort(item.due_date)}` : 'Sin vencimiento'}
          {item.status === 'settled' && ' · Saldado'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'text-sm font-semibold',
            item.status === 'settled'
              ? 'text-white/40 line-through'
              : isDebt
                ? 'text-danger'
                : 'text-success',
          )}
        >
          {money(pending)}
        </span>
        {item.status === 'open' && (
          <button
            title="Marcar saldado"
            onClick={() => settle.mutate()}
            className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-emerald-300"
          >
            <Check className="h-4 w-4" />
          </button>
        )}
        <button
          title="Eliminar"
          onClick={() => remove.mutate()}
          className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function DebtModal({
  ctx,
  onClose,
  onSaved,
}: {
  ctx: Ctx;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<DebtCreditKind>('debt');
  const [counterparty, setCounterparty] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      await execute(
        `INSERT INTO debt_credit
           (id, organization_id, branch_id, kind, counterparty, description, amount,
            paid_amount, due_date, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'open', ?, ?, ?)`,
        [
          genId(),
          ctx.orgId,
          ctx.branchId,
          kind,
          counterparty,
          description || null,
          Number(amount),
          dueDate || null,
          ctx.userId,
          now,
          now,
        ],
      );
    },
    onSuccess: onSaved,
  });

  return (
    <Modal open onClose={onClose} title="Nueva deuda o crédito">
      <div className="space-y-4">
        <Select
          label="Tipo"
          value={kind}
          onChange={(e) => setKind(e.target.value as DebtCreditKind)}
        >
          <option value="debt">Por pagar (le debemos a alguien)</option>
          <option value="credit">Por cobrar (nos deben)</option>
        </Select>
        <Input
          label={kind === 'debt' ? 'Acreedor' : 'Deudor'}
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder="Nombre de la persona o proveedor"
        />
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          label="Vencimiento (opcional)"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <Input
          label="Descripción (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button
          className="w-full"
          disabled={!counterparty || !amount || Number(amount) <= 0}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Guardar
        </Button>
      </div>
    </Modal>
  );
}

/* ─────────────────────── Transacciones (ingresos / egresos) ─────────────────────── */

interface TxRow {
  id: string;
  direction: CashDirection;
  category: string;
  reference: string | null;
  note: string | null;
  method_name: string;
  method_type: PaymentMethod['method_type'];
  amount: number;
  at: string;
}

function TransactionsSection({ branchId }: { branchId: string }) {
  const [range, setRange] = useState<'day' | 'month'>('day');
  const bounds = useMemo(() => {
    const now = new Date();
    if (range === 'day') {
      const d = todayISO();
      return { from: d, to: d, monthKey: null as string | null };
    }
    return { from: null as string | null, to: null as string | null, monthKey: ym(now) };
  }, [range]);

  const txs = useQuery({
    queryKey: ['transactions', branchId, range, bounds.monthKey ?? bounds.from],
    enabled: !!branchId,
    queryFn: () => {
      const dayMode = range === 'day';
      const key = dayMode ? bounds.from! : bounds.monthKey!;
      const len = dayMode ? 10 : 7;
      return query<TxRow>(
        `SELECT * FROM (
           SELECT p.id AS id,
                  'in' AS direction,
                  'Cobro / ingreso' AS category,
                  COALESCE(s.sale_number, p.reference, 'Ingreso') AS reference,
                  p.reference AS note,
                  pm.name AS method_name,
                  pm.method_type AS method_type,
                  p.amount AS amount,
                  p.paid_at AS at
             FROM payment p
             LEFT JOIN sale s ON s.id = p.sale_id
             JOIN payment_method pm ON pm.id = p.payment_method_id
            WHERE p.branch_id = ? AND p.status = 'confirmed'
              AND substr(p.paid_at, 1, ?) = ?
           UNION ALL
           SELECT e.id AS id,
                  'out' AS direction,
                  ec.name AS category,
                  e.description AS reference,
                  e.receipt_number AS note,
                  pm.name AS method_name,
                  pm.method_type AS method_type,
                  e.amount AS amount,
                  e.created_at AS at
             FROM expense e
             JOIN expense_category ec ON ec.id = e.expense_category_id
             JOIN payment_method pm ON pm.id = e.payment_method_id
            WHERE e.branch_id = ? AND e.status <> 'voided'
              AND substr(e.expense_date, 1, ?) = ?
         ) t
         ORDER BY t.at DESC`,
        [branchId, len, key, branchId, len, key],
      );
    },
  });

  const rows = txs.data ?? [];
  const totalIn = rows
    .filter((r) => r.direction === 'in')
    .reduce((a, r) => a + r.amount, 0);
  const totalOut = rows
    .filter((r) => r.direction === 'out')
    .reduce((a, r) => a + r.amount, 0);

  return (
    <Card>
      <CardHeader
        title="Transacciones"
        subtitle="Ingresos y egresos"
        action={
          <div className="flex rounded-xl bg-white/5 p-1">
            {(['day', 'month'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-medium transition-colors',
                  range === r
                    ? 'bg-gold-400 text-ink-950'
                    : 'text-white/50 hover:text-white',
                )}
              >
                {r === 'day' ? 'Hoy' : 'Mes'}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Metric label="Ingresos" value={money(totalIn)} tone="success" />
        <Metric label="Egresos" value={money(totalOut)} tone="danger" />
        <Metric label="Neto" value={money(totalIn - totalOut)} gold />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Receipt} title="Sin transacciones en el periodo" />
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
                <th className="px-2 py-2 font-medium">Fecha</th>
                <th className="px-2 py-2 font-medium">Tipo</th>
                <th className="px-2 py-2 font-medium">Categoría</th>
                <th className="px-2 py-2 font-medium">Detalle</th>
                <th className="px-2 py-2 font-medium">Método</th>
                <th className="px-2 py-2 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => {
                const isIn = r.direction === 'in';
                return (
                  <tr key={r.id} className="text-white/80">
                    <td className="whitespace-nowrap px-2 py-2 text-white/50">
                      {range === 'day' ? timeShort(r.at) : dateShort(r.at)}
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={isIn ? 'success' : 'danger'}>
                        {isIn ? 'Ingreso' : 'Egreso'}
                      </Badge>
                    </td>
                    <td className="px-2 py-2">{r.category}</td>
                    <td className="px-2 py-2">
                      <span className="text-white">{r.reference ?? '—'}</span>
                      {r.note && (
                        <span className="block text-xs text-white/40">
                          {r.note}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-white/60">
                      {r.method_name}
                    </td>
                    <td
                      className={`whitespace-nowrap px-2 py-2 text-right font-medium ${
                        isIn ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {isIn ? '+' : '−'}
                      {money(r.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Metric({
  label,
  value,
  gold,
  tone,
}: {
  label: string;
  value: string;
  gold?: boolean;
  tone?: 'danger' | 'success';
}) {
  const color = gold
    ? 'kpi-gold'
    : tone === 'danger'
      ? 'text-danger'
      : tone === 'success'
        ? 'text-success'
        : 'text-white';
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <p className="text-xs text-white/50">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}
