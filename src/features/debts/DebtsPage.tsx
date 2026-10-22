import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Receipt,
  Check,
  Trash2,
  AlertTriangle,
  Search,
  Pencil,
  HandCoins,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DateInput,
  EmptyState,
  Input,
  Modal,
  useToast,
} from '@/components/ui';
import { query, execute, batch, type Stmt } from '@/lib/db';
import { genId, money, dateShort, todayISO } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useSession, useBranchId, useOrgId } from '@/store/session';
import { invalidateFinance } from '@/lib/queryClient';
import type {
  BankAccount,
  DebtCredit,
  DebtCreditKind,
  PaymentMethod,
} from '@/types';
import { AccountSelect, paymentMethodFor, useBankAccounts, usePaymentMethods } from '@/features/cashflow/accounts';
import { ExportMenu } from '@/features/cashflow/lib/ExportMenu';
import type { ExportColumn } from '@/features/cashflow/lib/exportTx';
import { CollectSection } from '@/features/cashflow/CollectSection';

type FilterKind = 'all' | 'debt' | 'credit';
type FilterStatus = 'all' | 'open' | 'overdue' | 'settled';

/**
 * Pantalla aparte de deudas y préstamos: antes era una pestaña dentro de
 * /finanzas; se separa para dar sitio a filtros, pagos parciales y exports.
 */
export function DebtsPage() {
  const branchId = useBranchId();
  const orgId = useOrgId();
  const userId = useSession((s) => s.user?.id ?? null);
  const cashSession = useSession((s) => s.cashSession);
  const qc = useQueryClient();
  const [modal, setModal] = useState<DebtCredit | 'new' | null>(null);
  const [paying, setPaying] = useState<DebtCredit | null>(null);
  const [kind, setKind] = useState<FilterKind>('all');
  const [status, setStatus] = useState<FilterStatus>('open');
  const [q, setQ] = useState('');

  const refresh = () => invalidateFinance(qc, branchId);

  const items = useQuery({
    queryKey: ['fin-debts', branchId],
    enabled: !!branchId,
    queryFn: () =>
      query<DebtCredit>(
        `SELECT * FROM debt_credit
          WHERE branch_id = ? AND status <> 'voided'
          ORDER BY status = 'settled', due_date IS NULL, due_date`,
        [branchId],
      ),
  });

  const today = todayISO();
  const rows = useMemo(() => items.data ?? [], [items.data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false;
      if (status === 'open' && r.status !== 'open') return false;
      if (status === 'settled' && r.status !== 'settled') return false;
      if (status === 'overdue') {
        if (r.status !== 'open') return false;
        if (!r.due_date || r.due_date >= today) return false;
      }
      if (!needle) return true;
      return (
        r.counterparty.toLowerCase().includes(needle) ||
        (r.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [rows, kind, status, q, today]);

  const debts = rows.filter((r) => r.kind === 'debt');
  const credits = rows.filter((r) => r.kind === 'credit');
  const pending = (list: DebtCredit[]) =>
    list
      .filter((r) => r.status === 'open')
      .reduce((a, r) => a + (r.amount - r.paid_amount), 0);
  const overdueCount = rows.filter(
    (r) => r.status === 'open' && r.due_date && r.due_date < today,
  ).length;

  const exportCols: ExportColumn<DebtCredit>[] = [
    { header: 'Tipo', value: (r) => (r.kind === 'debt' ? 'Por pagar' : 'Por cobrar') },
    { header: 'Contraparte', value: (r) => r.counterparty },
    { header: 'Descripción', value: (r) => r.description ?? '' },
    { header: 'Vence', value: (r) => r.due_date ?? '' },
    { header: 'Total', value: (r) => r.amount.toFixed(2) },
    { header: 'Pagado', value: (r) => r.paid_amount.toFixed(2) },
    { header: 'Pendiente', value: (r) => (r.amount - r.paid_amount).toFixed(2) },
    { header: 'Estado', value: (r) => r.status },
  ];

  return (
    <div className="mx-auto max-w-[1300px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Deudas y préstamos</h1>
          <p className="text-sm text-white/50">
            Cuentas por pagar y por cobrar — pagos parciales y vencimientos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Deudas y préstamos"
            rows={filtered}
            columns={exportCols}
          />
          <Button onClick={() => setModal('new')}>
            <Plus className="h-4 w-4" /> Nueva
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-white/50">Por pagar</p>
            <p className="mt-1 text-xl font-semibold text-danger">
              {money(pending(debts))}
            </p>
            <p className="mt-0.5 text-xs text-white/40">
              {debts.filter((r) => r.status === 'open').length} abiertas
            </p>
          </div>
        </Card>
        <Card>
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-white/50">Por cobrar</p>
            <p className="mt-1 text-xl font-semibold text-success">
              {money(pending(credits))}
            </p>
            <p className="mt-0.5 text-xs text-white/40">
              {credits.filter((r) => r.status === 'open').length} abiertas
            </p>
          </div>
        </Card>
        <Card>
          <div className="rounded-xl bg-white/5 p-3">
            <p className="flex items-center gap-1.5 text-xs text-white/50">
              <AlertTriangle className="h-3.5 w-3.5" /> Vencidas
            </p>
            <p
              className={cn(
                'mt-1 text-xl font-semibold',
                overdueCount > 0 ? 'text-amber-300' : 'text-white',
              )}
            >
              {overdueCount}
            </p>
            <p className="mt-0.5 text-xs text-white/40">Pendientes atrasadas</p>
          </div>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg bg-white/5 p-0.5">
            {(
              [
                ['all', 'Todas'],
                ['debt', 'Por pagar'],
                ['credit', 'Por cobrar'],
              ] as const
            ).map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => setKind(v)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  kind === v
                    ? v === 'debt'
                      ? 'bg-danger/20 text-danger'
                      : v === 'credit'
                        ? 'bg-success/20 text-success'
                        : 'bg-gold-400 text-ink-950'
                    : 'text-white/50 hover:text-white',
                )}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg bg-white/5 p-0.5">
            {(
              [
                ['open', 'Abiertas'],
                ['overdue', 'Vencidas'],
                ['settled', 'Saldadas'],
                ['all', 'Todas'],
              ] as const
            ).map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => setStatus(v)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  status === v
                    ? 'bg-gold-400 text-ink-950'
                    : 'text-white/50 hover:text-white',
                )}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="relative ml-auto min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar contraparte o descripción…"
              className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder-white/30 focus:border-gold/40 focus:outline-none"
            />
          </div>
        </div>
      </Card>

      <CollectSection ctx={{ orgId, branchId, userId, sessionId: cashSession?.id ?? null }} />

      <Card>
        <CardHeader
          title="Listado"
          subtitle={
            filtered.length > 0
              ? `${filtered.length} registro(s)`
              : 'Sin resultados con los filtros actuales'
          }
        />
        {filtered.length === 0 ? (
          <EmptyState icon={Receipt} title="Sin resultados" />
        ) : (
          <ul className="divide-y divide-white/5">
            {filtered.map((r) => (
              <DebtRow
                key={r.id}
                item={r}
                today={today}
                onPay={() => setPaying(r)}
                onEdit={() => setModal(r)}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}
      </Card>

      {modal && (
        <DebtModal
          initial={modal === 'new' ? null : modal}
          orgId={orgId}
          branchId={branchId}
          userId={userId}
          onClose={() => setModal(null)}
          onSaved={() => {
            refresh();
            setModal(null);
          }}
        />
      )}

      {paying && (
        <PayDebtModal
          item={paying}
          orgId={orgId}
          branchId={branchId}
          userId={userId}
          sessionId={cashSession?.id ?? null}
          onClose={() => setPaying(null)}
          onSaved={() => {
            refresh();
            setPaying(null);
          }}
        />
      )}
    </div>
  );
}

function DebtRow({
  item,
  today,
  onPay,
  onEdit,
  onChanged,
}: {
  item: DebtCredit;
  today: string;
  onPay: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const pending = item.amount - item.paid_amount;
  const isDebt = item.kind === 'debt';
  const overdue =
    item.status === 'open' && item.due_date != null && item.due_date < today;
  const partial = item.paid_amount > 0 && item.status === 'open';

  const settle = useMutation({
    mutationFn: () =>
      execute(
        `UPDATE debt_credit SET status='settled', paid_amount=amount, updated_at=? WHERE id = ?`,
        [new Date().toISOString(), item.id],
      ),
    onSuccess: () => {
      toast.success(isDebt ? 'Deuda saldada' : 'Cobro registrado', item.counterparty);
      onChanged();
    },
    onError: (e: Error) => toast.error('No se pudo saldar', e.message),
  });

  const remove = useMutation({
    mutationFn: () =>
      execute(
        `UPDATE debt_credit SET status='voided', updated_at=? WHERE id = ?`,
        [new Date().toISOString(), item.id],
      ),
    onSuccess: () => {
      toast.info('Registro anulado', item.counterparty);
      onChanged();
    },
    onError: (e: Error) => toast.error('No se pudo anular', e.message),
  });

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge tone={isDebt ? 'danger' : 'success'}>
            {isDebt ? 'Por pagar' : 'Por cobrar'}
          </Badge>
          {overdue && <Badge tone="danger">Vencida</Badge>}
          {partial && <Badge tone="muted">Parcial</Badge>}
          <p className="truncate text-sm text-white">{item.counterparty}</p>
        </div>
        <p className="text-xs text-white/40">
          {item.description ? `${item.description} · ` : ''}
          {item.due_date ? `Vence ${dateShort(item.due_date)}` : 'Sin vencimiento'}
          {item.status === 'settled' && ' · Saldado'}
          {partial && ` · Pagado ${money(item.paid_amount)} de ${money(item.amount)}`}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
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
          <>
            <button
              title={isDebt ? 'Registrar pago' : 'Registrar cobro'}
              onClick={onPay}
              className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-gold-300"
            >
              <HandCoins className="h-4 w-4" />
            </button>
            <button
              title="Marcar saldado"
              onClick={() => settle.mutate()}
              className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-emerald-300"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              title="Editar"
              onClick={onEdit}
              className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </>
        )}
        <button
          title="Anular"
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
  initial,
  orgId,
  branchId,
  userId,
  onClose,
  onSaved,
}: {
  initial: DebtCredit | null;
  orgId: string;
  branchId: string;
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<DebtCreditKind>(initial?.kind ?? 'debt');
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(
    initial ? String(initial.amount) : '',
  );
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '');

  const save = useMutation({
    mutationFn: () => {
      const now = new Date().toISOString();
      if (initial) {
        return execute(
          `UPDATE debt_credit
              SET kind=?, counterparty=?, description=?, amount=?, due_date=?, updated_at=?
            WHERE id = ?`,
          [
            kind,
            counterparty,
            description || null,
            Number(amount),
            dueDate || null,
            now,
            initial.id,
          ],
        );
      }
      return execute(
        `INSERT INTO debt_credit
           (id, organization_id, branch_id, kind, counterparty, description,
            amount, paid_amount, due_date, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'open', ?, ?, ?)`,
        [
          genId(),
          orgId,
          branchId,
          kind,
          counterparty,
          description || null,
          Number(amount),
          dueDate || null,
          userId,
          now,
          now,
        ],
      );
    },
    onSuccess: () => {
      toast.success(initial ? 'Registro actualizado' : 'Registro creado', counterparty);
      onSaved();
    },
    onError: (e: Error) => toast.error('No se pudo guardar', e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Editar deuda / crédito' : 'Nueva deuda o crédito'}
    >
      <div className="space-y-4">
        <div className="flex rounded-lg bg-white/5 p-0.5">
          {(['debt', 'credit'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                'flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                kind === k
                  ? k === 'debt'
                    ? 'bg-danger/20 text-danger'
                    : 'bg-success/20 text-success'
                  : 'text-white/50 hover:text-white',
              )}
            >
              {k === 'debt' ? 'Por pagar' : 'Por cobrar'}
            </button>
          ))}
        </div>
        <Input
          label="Contraparte"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder={kind === 'debt' ? 'A quién le debés' : 'Quién te debe'}
        />
        <Input
          label="Descripción (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <div>
          <label className="text-xs font-medium text-white/40">
            Vencimiento (opcional)
          </label>
          <DateInput value={dueDate} onChange={setDueDate} />
        </div>
        <Button
          className="w-full"
          disabled={!counterparty || !amount || Number(amount) <= 0}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {initial ? 'Guardar cambios' : 'Crear registro'}
        </Button>
      </div>
    </Modal>
  );
}

function PayDebtModal({
  item,
  orgId,
  branchId,
  userId,
  sessionId,
  onClose,
  onSaved,
}: {
  item: DebtCredit;
  orgId: string;
  branchId: string;
  userId: string | null;
  sessionId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const pendingAmount = item.amount - item.paid_amount;
  const [amount, setAmount] = useState(String(pendingAmount));
  const [source, setSource] = useState('');

  const methods: { data?: PaymentMethod[] } = usePaymentMethods(orgId, true);
  const banks: { data?: BankAccount[] } = useBankAccounts(orgId, true);

  const isCash = source === 'cash';
  const needsSession = isCash && !sessionId;
  const isDebt = item.kind === 'debt';

  const pay = useMutation({
    mutationFn: async () => {
      const method = paymentMethodFor(methods.data, banks.data, source);
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : source;
      const now = new Date().toISOString();
      const value = Number(amount);
      const stmts: Stmt[] = [];

      if (isDebt) {
        // Pago a un proveedor: egresa plata. Se registra como `expense` sin
        // categoría concreta — queda etiquetado como pago de deuda.
        const expenseCategory = await queryOneCategory(orgId);
        const expenseId = genId();
        stmts.push({
          sql: `INSERT INTO expense
                  (id, organization_id, branch_id, expense_category_id, payment_method_id,
                   bank_account_id, expense_date, description, amount, status, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
          args: [
            expenseId,
            orgId,
            branchId,
            expenseCategory,
            method.id,
            bankId,
            todayISO(),
            `[Pago deuda] ${item.counterparty}`,
            value,
            userId,
            now,
            now,
          ],
        });
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
              `[Pago deuda] ${item.counterparty}`,
              userId,
            ],
          });
        }
      } else {
        // Cobro de un crédito otorgado: ingreso de plata sin venta.
        const paymentId = genId();
        const label = `[Cobro crédito] ${item.counterparty}`;
        stmts.push({
          sql: `INSERT INTO payment
                  (id, organization_id, branch_id, sale_id, payment_method_id,
                   bank_account_id, paid_at, amount, status, reference, created_by)
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'confirmed', ?, ?)`,
          args: [
            paymentId,
            orgId,
            branchId,
            method.id,
            bankId,
            now,
            value,
            label,
            userId,
          ],
        });
        if (isCash) {
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
              now,
              paymentId,
              label,
              userId,
            ],
          });
        }
      }

      // Avanza el pagado; si llega al total queda saldado.
      const newPaid = item.paid_amount + value;
      const newStatus = newPaid >= item.amount ? 'settled' : 'open';
      stmts.push({
        sql: `UPDATE debt_credit
                 SET paid_amount = ?, status = ?, updated_at = ?
               WHERE id = ?`,
        args: [Math.min(newPaid, item.amount), newStatus, now, item.id],
      });

      await batch(stmts);
    },
    onSuccess: () => {
      toast.success(isDebt ? 'Pago registrado' : 'Cobro registrado', item.counterparty);
      onSaved();
    },
    onError: (e: Error) => toast.error('No se pudo registrar', e.message),
  });

  const canPay =
    source !== '' &&
    !needsSession &&
    Number(amount) > 0 &&
    Number(amount) <= pendingAmount + 0.001;

  return (
    <Modal
      open
      onClose={onClose}
      title={isDebt ? `Pagar a ${item.counterparty}` : `Cobrar a ${item.counterparty}`}
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>Pendiente</span>
            <span className="kpi-gold">{money(pendingAmount)}</span>
          </div>
        </div>
        <Input
          label="Monto a registrar"
          type="number"
          min="0"
          step="0.01"
          max={pendingAmount}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <AccountSelect
          label={isDebt ? 'Pagar desde' : 'Depositar en'}
          value={source}
          onChange={setSource}
          accounts={banks.data}
        />
        {needsSession && (
          <p className="text-xs text-danger">
            Para un movimiento en efectivo necesitás abrir la caja primero.
          </p>
        )}
        <Button
          className="w-full"
          disabled={!canPay}
          loading={pay.isPending}
          onClick={() => pay.mutate()}
        >
          <HandCoins className="h-4 w-4" />
          {isDebt ? 'Registrar pago' : 'Registrar cobro'}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Devuelve una categoría de egreso válida para marcar los pagos de deudas.
 * Toma la primera activa; si no existe ninguna, lanza para que el UI avise.
 */
async function queryOneCategory(orgId: string): Promise<string> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM expense_category WHERE organization_id = ? AND active = 1 ORDER BY name LIMIT 1`,
    [orgId],
  );
  const first = rows[0];
  if (!first) {
    throw new Error(
      'No hay categorías de egreso. Creá una en Configuración para registrar pagos de deuda.',
    );
  }
  return first.id;
}
