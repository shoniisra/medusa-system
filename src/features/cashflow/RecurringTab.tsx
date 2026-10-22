import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Repeat,
  Plus,
  Play,
  Pause,
  Pencil,
  Trash2,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
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
  Select,
  useToast,
} from '@/components/ui';
import { query, batch, execute } from '@/lib/db';
import { money, dateShort } from '@/lib/format';
import { cn } from '@/lib/cn';
import { invalidateFinance } from '@/lib/queryClient';
import type {
  BankAccount,
  ExpenseCategory,
  PaymentMethod,
  RecurringFrequency,
  RecurringKind,
  RecurringTransaction,
} from '@/types';
import {
  AccountSelect,
  paymentMethodFor,
  usePaymentMethods,
  useBankAccounts,
} from './accounts';
import {
  FREQUENCY_LABEL,
  WEEKDAY_LABEL,
  runRecurringStatements,
  todayLocal,
  upsertRecurringStatements,
} from './recurring';

interface Ctx {
  orgId: string;
  branchId: string;
  userId: string | null;
  sessionId: string | null;
}

export function RecurringTab({ ctx }: { ctx: Ctx }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);
  const [creating, setCreating] = useState(false);

  const items = useQuery({
    queryKey: ['fin-recurring', ctx.branchId],
    enabled: !!ctx.branchId,
    queryFn: () =>
      query<RecurringTransaction>(
        `SELECT * FROM recurring_transaction
          WHERE branch_id = ?
          ORDER BY active DESC, next_run_date ASC, description`,
        [ctx.branchId],
      ),
  });

  const today = todayLocal();
  const rows = useMemo(() => items.data ?? [], [items.data]);
  const due = useMemo(
    () => rows.filter((r) => r.active && r.next_run_date <= today),
    [rows, today],
  );
  const upcoming = useMemo(
    () => rows.filter((r) => r.active && r.next_run_date > today),
    [rows, today],
  );
  const paused = rows.filter((r) => !r.active);

  const refresh = () => invalidateFinance(qc, ctx.branchId);

  const run = useMutation({
    mutationFn: (r: RecurringTransaction) =>
      batch(
        runRecurringStatements(r, {
          cashSessionId: ctx.sessionId,
          userId: ctx.userId,
        }),
      ),
    onSuccess: (_d, r) => {
      toast.success('Recurrente ejecutada', r.description);
      refresh();
    },
    onError: (e: Error) => toast.error('No se pudo ejecutar', e.message),
  });

  const togglePause = useMutation({
    mutationFn: (r: RecurringTransaction) =>
      execute(
        `UPDATE recurring_transaction
            SET active = ?, updated_at = ?
          WHERE id = ?`,
        [r.active ? 0 : 1, new Date().toISOString(), r.id],
      ),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error('No se pudo actualizar', e.message),
  });

  const remove = useMutation({
    mutationFn: (r: RecurringTransaction) =>
      execute(`DELETE FROM recurring_transaction WHERE id = ?`, [r.id]),
    onSuccess: () => {
      toast.info('Recurrente eliminada');
      refresh();
    },
    onError: (e: Error) => toast.error('No se pudo eliminar', e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Nueva recurrente
        </Button>
      </div>

      {/* Vencidas: lo primero que ve el usuario, un clic para generar */}
      {due.length > 0 && (
        <Card>
          <CardHeader
            title="Pendientes de generar"
            subtitle={`${due.length} vencida(s). Al ejecutar se registra el gasto o ingreso real.`}
          />
          <ul className="divide-y divide-white/5">
            {due.map((r) => (
              <RecurringRow
                key={r.id}
                r={r}
                due
                needsCashSession={r.bank_account_id == null && !ctx.sessionId}
                onRun={() => run.mutate(r)}
                running={run.isPending && run.variables?.id === r.id}
                onEdit={() => setEditing(r)}
                onPauseToggle={() => togglePause.mutate(r)}
                onDelete={() => remove.mutate(r)}
              />
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Próximas recurrentes"
          subtitle="Gastos e ingresos programados en el calendario"
        />
        {upcoming.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="Sin recurrentes activas"
            description="Programá alquiler, servicios, sueldos fijos o aportes periódicos."
          />
        ) : (
          <ul className="divide-y divide-white/5">
            {upcoming.map((r) => (
              <RecurringRow
                key={r.id}
                r={r}
                onEdit={() => setEditing(r)}
                onPauseToggle={() => togglePause.mutate(r)}
                onDelete={() => remove.mutate(r)}
              />
            ))}
          </ul>
        )}
      </Card>

      {paused.length > 0 && (
        <Card>
          <CardHeader title="Pausadas" />
          <ul className="divide-y divide-white/5">
            {paused.map((r) => (
              <RecurringRow
                key={r.id}
                r={r}
                paused
                onEdit={() => setEditing(r)}
                onPauseToggle={() => togglePause.mutate(r)}
                onDelete={() => remove.mutate(r)}
              />
            ))}
          </ul>
        </Card>
      )}

      {(creating || editing) && (
        <RecurringModal
          ctx={ctx}
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            refresh();
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function RecurringRow({
  r,
  due,
  paused,
  onRun,
  running,
  needsCashSession,
  onEdit,
  onPauseToggle,
  onDelete,
}: {
  r: RecurringTransaction;
  due?: boolean;
  paused?: boolean;
  onRun?: () => void;
  running?: boolean;
  needsCashSession?: boolean;
  onEdit: () => void;
  onPauseToggle: () => void;
  onDelete: () => void;
}) {
  const isExpense = r.kind === 'expense';
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1',
          isExpense
            ? 'bg-danger/10 text-danger ring-danger/20'
            : 'bg-success/10 text-success ring-success/20',
        )}
      >
        {isExpense ? (
          <ArrowUpRight className="h-5 w-5" />
        ) : (
          <ArrowDownLeft className="h-5 w-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-white">
            {r.description}
          </p>
          <Badge tone={isExpense ? 'danger' : 'success'}>
            {FREQUENCY_LABEL[r.frequency]}
          </Badge>
          {paused && <Badge tone="muted">Pausada</Badge>}
        </div>
        <p className="text-xs text-white/40">
          {dateShort(r.next_run_date)}
          {r.last_run_date && ` · última ${dateShort(r.last_run_date)}`}
          {r.bank_account_id ? ' · banco' : ' · efectivo'}
        </p>
      </div>
      <span
        className={cn(
          'text-sm font-semibold',
          isExpense ? 'text-danger' : 'text-success',
        )}
      >
        {isExpense ? '−' : '+'}
        {money(r.amount)}
      </span>
      <div className="flex items-center gap-1">
        {due && onRun && (
          <Button
            size="sm"
            disabled={needsCashSession}
            loading={running}
            onClick={onRun}
            title={
              needsCashSession
                ? 'Abrí la caja para generar un movimiento en efectivo'
                : 'Generar ahora'
            }
          >
            <Play className="h-4 w-4" /> Ejecutar
          </Button>
        )}
        <button
          onClick={onEdit}
          className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          title="Editar"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={onPauseToggle}
          className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          title={r.active ? 'Pausar' : 'Activar'}
        >
          {r.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          onClick={onDelete}
          className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-danger"
          title="Eliminar"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

const INCOME_REASONS = [
  'Aporte de capital',
  'Préstamo recibido',
  'Alquiler cobrado',
  'Otro',
];

function RecurringModal({
  ctx,
  initial,
  onClose,
  onSaved,
}: {
  ctx: Ctx;
  initial: RecurringTransaction | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<RecurringKind>(initial?.kind ?? 'expense');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(
    initial ? String(initial.amount) : '',
  );
  const [categoryId, setCategoryId] = useState(
    initial?.expense_category_id ?? '',
  );
  const [incomeReason, setIncomeReason] = useState(
    initial?.income_reason ?? '',
  );
  const [source, setSource] = useState(() => {
    if (!initial) return '';
    return initial.bank_account_id ?? 'cash';
  });
  const [frequency, setFrequency] = useState<RecurringFrequency>(
    initial?.frequency ?? 'monthly',
  );
  const [dayOfMonth, setDayOfMonth] = useState(
    initial?.day_of_month != null ? String(initial.day_of_month) : '1',
  );
  const [weekday, setWeekday] = useState(
    initial?.weekday != null ? String(initial.weekday) : '1',
  );
  const [startDate, setStartDate] = useState(
    initial?.start_date ?? todayLocal(),
  );
  const [endDate, setEndDate] = useState(initial?.end_date ?? '');

  const categories = useQuery({
    queryKey: ['expense-categories', ctx.orgId],
    enabled: !!ctx.orgId && kind === 'expense',
    queryFn: () =>
      query<ExpenseCategory>(
        'SELECT * FROM expense_category WHERE organization_id = ? AND active = 1 ORDER BY name',
        [ctx.orgId],
      ),
  });
  const methods: { data?: PaymentMethod[] } = usePaymentMethods(ctx.orgId, true);
  const banks: { data?: BankAccount[] } = useBankAccounts(ctx.orgId, true);

  const isCash = source === 'cash';

  const save = useMutation({
    mutationFn: async () => {
      const method = paymentMethodFor(methods.data, banks.data, source);
      if (!method) throw new Error('No hay un método de pago configurado.');
      const bankId = isCash ? null : source;

      await batch(
        upsertRecurringStatements({
          id: initial?.id ?? null,
          orgId: ctx.orgId,
          branchId: ctx.branchId,
          kind,
          description,
          amount: Number(amount),
          expenseCategoryId: kind === 'expense' ? categoryId : null,
          incomeReason: kind === 'income' ? incomeReason || null : null,
          paymentMethodId: method.id,
          bankAccountId: bankId,
          frequency,
          dayOfMonth:
            frequency === 'monthly' || frequency === 'yearly'
              ? Number(dayOfMonth)
              : null,
          weekday:
            frequency === 'weekly' || frequency === 'biweekly'
              ? Number(weekday)
              : null,
          startDate,
          endDate: endDate || null,
          active: initial ? Boolean(initial.active) : true,
          userId: ctx.userId,
        }),
      );
    },
    onSuccess: () => {
      toast.success(initial ? 'Recurrente actualizada' : 'Recurrente creada');
      onSaved();
    },
    onError: (e: Error) =>
      toast.error('No se pudo guardar la recurrente', e.message),
  });

  const canSave =
    description.trim().length > 0 &&
    Number(amount) > 0 &&
    source !== '' &&
    (kind === 'expense' ? Boolean(categoryId) : Boolean(incomeReason)) &&
    startDate.length === 10;

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Editar recurrente' : 'Nueva recurrente'}
    >
      <div className="space-y-4">
        {/* Tipo */}
        <div className="flex rounded-lg bg-white/5 p-0.5">
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                'flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                kind === k
                  ? k === 'expense'
                    ? 'bg-danger/20 text-danger'
                    : 'bg-success/20 text-success'
                  : 'text-white/50 hover:text-white',
              )}
            >
              {k === 'expense' ? 'Gasto' : 'Ingreso'}
            </button>
          ))}
        </div>

        <Input
          label="Descripción"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Alquiler, luz, internet, aporte socia…"
        />
        <Input
          label="Monto"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        {kind === 'expense' ? (
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
        ) : (
          <Select
            label="Motivo"
            value={incomeReason}
            onChange={(e) => setIncomeReason(e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {INCOME_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        )}

        <AccountSelect
          label={kind === 'expense' ? 'Pagar desde' : 'Depositar en'}
          value={source}
          onChange={setSource}
          accounts={banks.data}
        />

        <Select
          label="Frecuencia"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
        >
          <option value="weekly">Semanal</option>
          <option value="biweekly">Quincenal</option>
          <option value="monthly">Mensual</option>
          <option value="yearly">Anual</option>
        </Select>

        {(frequency === 'monthly' || frequency === 'yearly') && (
          <Input
            label="Día del mes (1–31)"
            type="number"
            min="1"
            max="31"
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
          />
        )}

        {(frequency === 'weekly' || frequency === 'biweekly') && (
          <Select
            label="Día de la semana"
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
          >
            {WEEKDAY_LABEL.map((lbl, i) => (
              <option key={lbl} value={i}>
                {lbl}
              </option>
            ))}
          </Select>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-white/40">
              Desde
            </label>
            <DateInput value={startDate} onChange={setStartDate} />
          </div>
          <div>
            <label className="text-xs font-medium text-white/40">
              Hasta (opcional)
            </label>
            <DateInput
              value={endDate}
              onChange={setEndDate}
              min={startDate || undefined}
            />
          </div>
        </div>

        <Button
          className="w-full"
          disabled={!canSave}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          <Calendar className="h-4 w-4" /> {initial ? 'Guardar cambios' : 'Crear recurrente'}
        </Button>
      </div>
    </Modal>
  );
}
