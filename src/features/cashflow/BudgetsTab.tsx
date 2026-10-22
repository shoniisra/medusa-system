import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Target, Pencil, Plus } from 'lucide-react';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  useToast,
} from '@/components/ui';
import { query, batch } from '@/lib/db';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  BUDGET_MONTH_SQL,
  budgetTone,
  upsertBudgetStatements,
  type BudgetRow,
} from './budgets';

interface Props {
  ctx: {
    orgId: string;
    branchId: string;
    userId: string | null;
  };
}

const ym = (d: Date) => d.toISOString().slice(0, 10).slice(0, 7);
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('es-EC', {
    month: 'long',
    year: 'numeric',
  });

export function BudgetsTab({ ctx }: Props) {
  const [month, setMonth] = useState(() => ym(new Date()));
  const [editing, setEditing] = useState<BudgetRow | null>(null);
  const qc = useQueryClient();

  const data = useQuery({
    queryKey: ['fin-budgets', ctx.branchId, month],
    enabled: !!ctx.branchId && !!ctx.orgId,
    queryFn: () =>
      query<BudgetRow>(BUDGET_MONTH_SQL, [
        month,
        ctx.branchId,
        month,
        ctx.branchId,
        month,
        ctx.orgId,
      ]),
  });

  const rows = useMemo(() => data.data ?? [], [data.data]);
  const totals = useMemo(() => {
    const budgeted = rows.reduce((a, r) => a + r.amount, 0);
    const spent = rows.reduce((a, r) => a + r.spent, 0);
    return { budgeted, spent, remaining: budgeted - spent };
  }, [rows]);

  const shiftMonth = (delta: number) => {
    const d = new Date(`${month}-01T00:00:00`);
    d.setMonth(d.getMonth() + delta);
    setMonth(ym(d));
  };

  const budgeted = rows.filter((r) => r.amount > 0);
  const unbudgeted = rows.filter((r) => r.amount <= 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => shiftMonth(-1)}
          className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-[10rem] text-center text-lg font-semibold capitalize text-white">
          {monthLabel(month)}
        </span>
        <button
          onClick={() => shiftMonth(1)}
          className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <Card gold>
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Presupuestado" value={money(totals.budgeted)} />
          <Metric
            label="Gastado"
            value={money(totals.spent)}
            tone={
              totals.budgeted > 0 && totals.spent >= totals.budgeted
                ? 'danger'
                : 'default'
            }
          />
          <Metric
            label="Disponible"
            value={money(totals.remaining)}
            tone={totals.remaining < 0 ? 'danger' : 'success'}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Presupuestos del mes"
          subtitle="Topes definidos por categoría"
        />
        {budgeted.length === 0 ? (
          <EmptyState
            icon={Target}
            title="Sin presupuestos cargados"
            description="Definí un tope mensual para cada categoría de gasto y seguí tu consumo."
          />
        ) : (
          <ul className="divide-y divide-white/5">
            {budgeted.map((r) => (
              <BudgetItem key={r.expense_category_id} row={r} onEdit={setEditing} />
            ))}
          </ul>
        )}
      </Card>

      {unbudgeted.length > 0 && (
        <Card>
          <CardHeader
            title="Sin presupuesto"
            subtitle={`${unbudgeted.length} categoría(s) sin tope este mes`}
          />
          <ul className="divide-y divide-white/5">
            {unbudgeted.map((r) => (
              <li
                key={r.expense_category_id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{r.category_name}</p>
                  {r.spent > 0 && (
                    <p className="text-xs text-white/40">
                      Gastado {money(r.spent)}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(r)}
                >
                  <Plus className="h-4 w-4" /> Definir
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <BudgetModal
          ctx={ctx}
          row={editing}
          month={month}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['fin-budgets'] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function BudgetItem({
  row,
  onEdit,
}: {
  row: BudgetRow;
  onEdit: (r: BudgetRow) => void;
}) {
  const ratio = row.amount > 0 ? row.spent / row.amount : 0;
  const tone = budgetTone(row.spent, row.amount);
  const remaining = row.amount - row.spent;
  const barColor =
    tone === 'danger'
      ? 'bg-danger'
      : tone === 'warn'
        ? 'bg-amber-400'
        : 'bg-success';

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-white">
              {row.category_name}
            </p>
            <button
              onClick={() => onEdit(row)}
              className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white"
              title="Editar"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-white/40">
            {money(row.spent)} de {money(row.amount)}
            {remaining >= 0
              ? ` · Disponible ${money(remaining)}`
              : ` · Excedido ${money(-remaining)}`}
          </p>
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
        />
      </div>
    </li>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'danger';
}) {
  const color =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'success'
        ? 'text-success'
        : 'text-white';
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <p className="text-xs text-white/50">{label}</p>
      <p className={cn('mt-1 text-xl font-semibold', color)}>{value}</p>
    </div>
  );
}

function BudgetModal({
  ctx,
  row,
  month,
  onClose,
  onSaved,
}: {
  ctx: Props['ctx'];
  row: BudgetRow;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState(row.amount > 0 ? String(row.amount) : '');
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: () =>
      batch(
        upsertBudgetStatements({
          id: row.id,
          orgId: ctx.orgId,
          branchId: ctx.branchId,
          categoryId: row.expense_category_id,
          periodMonth: month,
          amount: Number(amount),
          note: note || null,
          userId: ctx.userId,
        }),
      ),
    onSuccess: () => {
      toast.success('Presupuesto guardado', row.category_name);
      onSaved();
    },
    onError: (e: Error) => toast.error('No se pudo guardar', e.message),
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!row.id) throw new Error('Nada que eliminar.');
      return batch([
        { sql: 'DELETE FROM budget WHERE id = ?', args: [row.id] },
      ]);
    },
    onSuccess: () => {
      toast.info('Presupuesto eliminado', row.category_name);
      onSaved();
    },
    onError: (e: Error) => toast.error('No se pudo eliminar', e.message),
  });

  return (
    <Modal open onClose={onClose} title={row.category_name}>
      <div className="space-y-4">
        <p className="text-xs text-white/50">
          Tope mensual para <b>{monthLabel(month)}</b>. Lo gastado se calcula
          automáticamente desde los egresos de la categoría.
        </p>
        <Input
          label="Tope mensual"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
        <Input
          label="Nota (opcional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Por qué este monto"
        />
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={!amount || Number(amount) < 0}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Guardar
          </Button>
          {row.id && (
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Eliminar
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
