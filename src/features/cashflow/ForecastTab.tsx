import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  TrendingUp,
  TrendingDown,
  Scale,
  Repeat,
} from 'lucide-react';
import { Card, CardHeader, EmptyState, Badge } from '@/components/ui';
import { query, queryOne } from '@/lib/db';
import { money, dateShort } from '@/lib/format';
import { cn } from '@/lib/cn';
import type {
  BankAccount,
  DebtCredit,
  RecurringTransaction,
} from '@/types';
import { nextRunDate, todayLocal } from './recurring';

interface Ctx {
  orgId: string;
  branchId: string;
}

const HORIZONS: { days: number; label: string }[] = [
  { days: 30, label: '30 días' },
  { days: 60, label: '60 días' },
  { days: 90, label: '90 días' },
];

interface ForecastEvent {
  date: string;
  kind: 'recurring-expense' | 'recurring-income' | 'debt' | 'credit';
  description: string;
  amount: number; // Positivo entra, negativo sale.
}

/**
 * Flujo proyectado 30/60/90 días: saldo actual + deudas con vencimiento +
 * recurrentes activas proyectadas en el horizonte. Da una respuesta rápida a
 * "voy a poder pagar lo que viene este mes".
 */
export function ForecastTab({ ctx }: { ctx: Ctx }) {
  const [horizon, setHorizon] = useState(30);

  const today = todayLocal();
  const horizonDate = useMemo(() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() + horizon);
    return d.toISOString().slice(0, 10);
  }, [today, horizon]);

  // Saldo actual: bancos (no internas no, SON cuentas; incluimos todas) +
  // efectivo de la caja abierta más fondo del cierre anterior.
  const balance = useQuery({
    queryKey: ['fin-forecast-balance', ctx.branchId],
    enabled: !!ctx.branchId,
    queryFn: async () => {
      const banks = await query<BankAccount & { balance: number }>(
        `SELECT ba.*,
                COALESCE((SELECT SUM(p.amount) FROM payment p
                           WHERE p.bank_account_id = ba.id AND p.status='confirmed'),0)
              - COALESCE((SELECT SUM(e.amount) FROM expense e
                           WHERE e.bank_account_id = ba.id AND e.status<>'voided'),0)
              + COALESCE((SELECT SUM(t.amount) FROM account_transfer t
                           WHERE t.to_kind='bank' AND t.to_bank_account_id = ba.id),0)
              - COALESCE((SELECT SUM(t.amount) FROM account_transfer t
                           WHERE t.from_kind='bank' AND t.from_bank_account_id = ba.id),0)
                AS balance
           FROM bank_account ba
          WHERE ba.organization_id = ? AND ba.active = 1`,
        [ctx.orgId],
      );
      const cash = await queryOne<{ s: number }>(
        `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS s
           FROM cash_movement cm
           JOIN cash_session cs ON cs.id = cm.cash_session_id
          WHERE cm.branch_id = ? AND cs.status='open'`,
        [ctx.branchId],
      );
      const banksTotal = banks.reduce((a, b) => a + b.balance, 0);
      return { banks, banksTotal, cash: cash?.s ?? 0 };
    },
  });

  const recurring = useQuery({
    queryKey: ['fin-forecast-recurring', ctx.branchId],
    enabled: !!ctx.branchId,
    queryFn: () =>
      query<RecurringTransaction>(
        `SELECT * FROM recurring_transaction
          WHERE branch_id = ? AND active = 1
          ORDER BY next_run_date`,
        [ctx.branchId],
      ),
  });

  const debts = useQuery({
    queryKey: ['fin-forecast-debts', ctx.branchId],
    enabled: !!ctx.branchId,
    queryFn: () =>
      query<DebtCredit>(
        `SELECT * FROM debt_credit
          WHERE branch_id = ? AND status = 'open' AND due_date IS NOT NULL
          ORDER BY due_date`,
        [ctx.branchId],
      ),
  });

  const events = useMemo<ForecastEvent[]>(() => {
    const out: ForecastEvent[] = [];
    // Recurrentes: proyectar iteraciones hasta el horizonte.
    for (const r of recurring.data ?? []) {
      let d = r.next_run_date;
      let guard = 0;
      while (d <= horizonDate && (!r.end_date || d <= r.end_date) && guard < 24) {
        if (d >= today) {
          out.push({
            date: d,
            kind: r.kind === 'expense' ? 'recurring-expense' : 'recurring-income',
            description: r.description,
            amount: r.kind === 'expense' ? -r.amount : r.amount,
          });
        }
        d = nextRunDate(d, r.frequency, r.day_of_month);
        guard++;
      }
    }
    // Deudas por vencer.
    for (const d of debts.data ?? []) {
      if (!d.due_date) continue;
      if (d.due_date < today || d.due_date > horizonDate) continue;
      const pending = d.amount - d.paid_amount;
      if (pending <= 0) continue;
      out.push({
        date: d.due_date,
        kind: d.kind === 'debt' ? 'debt' : 'credit',
        description: d.counterparty + (d.description ? ' · ' + d.description : ''),
        amount: d.kind === 'debt' ? -pending : pending,
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [recurring.data, debts.data, today, horizonDate]);

  const inflow = events.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0);
  const outflow = events
    .filter((e) => e.amount < 0)
    .reduce((a, e) => a + e.amount, 0); // negativo
  const currentBalance =
    (balance.data?.banksTotal ?? 0) + (balance.data?.cash ?? 0);
  const projected = currentBalance + inflow + outflow;

  return (
    <div className="space-y-6">
      <div className="flex rounded-xl bg-white/5 p-1">
        {HORIZONS.map((h) => (
          <button
            key={h.days}
            onClick={() => setHorizon(h.days)}
            className={cn(
              'flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
              horizon === h.days
                ? 'bg-gold-400 text-ink-950 shadow-gold-glow'
                : 'text-white/50 hover:text-white',
            )}
          >
            Próximos {h.label}
          </button>
        ))}
      </div>

      <Card gold>
        <div className="grid gap-3 sm:grid-cols-4">
          <ForecastMetric
            icon={<Scale className="h-4 w-4" />}
            label="Saldo actual"
            value={money(currentBalance)}
          />
          <ForecastMetric
            icon={<TrendingUp className="h-4 w-4" />}
            label="Entradas previstas"
            value={money(inflow)}
            tone="success"
          />
          <ForecastMetric
            icon={<TrendingDown className="h-4 w-4" />}
            label="Salidas previstas"
            value={money(outflow)}
            tone="danger"
          />
          <ForecastMetric
            icon={<Calendar className="h-4 w-4" />}
            label="Saldo proyectado"
            value={money(projected)}
            tone={projected < 0 ? 'danger' : 'success'}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Calendario de pagos y cobros"
          subtitle={`Entre ${dateShort(today)} y ${dateShort(horizonDate)}`}
        />
        {events.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="Sin eventos en el horizonte"
            description="Programá recurrentes o cargá vencimientos de deudas para ver tu flujo."
          />
        ) : (
          <ul className="divide-y divide-white/5">
            {events.map((e, i) => (
              <ForecastRow key={`${e.date}-${e.description}-${i}`} ev={e} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ForecastMetric({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
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
      <p className="flex items-center gap-1.5 text-xs text-white/50">
        {icon} {label}
      </p>
      <p className={cn('mt-1 text-lg font-semibold', color)}>{value}</p>
    </div>
  );
}

function ForecastRow({ ev }: { ev: ForecastEvent }) {
  const income = ev.amount > 0;
  const tone =
    ev.kind === 'debt'
      ? 'danger'
      : ev.kind === 'credit'
        ? 'success'
        : income
          ? 'success'
          : 'danger';
  const label =
    ev.kind === 'recurring-expense'
      ? 'Recurrente'
      : ev.kind === 'recurring-income'
        ? 'Recurrente'
        : ev.kind === 'debt'
          ? 'Deuda por pagar'
          : 'Cobro pendiente';
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          <p className="truncate text-sm text-white">{ev.description}</p>
        </div>
        <p className="text-xs text-white/40">{dateShort(ev.date)}</p>
      </div>
      <span
        className={cn(
          'text-sm font-semibold',
          income ? 'text-success' : 'text-danger',
        )}
      >
        {income ? '+' : '−'}
        {money(Math.abs(ev.amount))}
      </span>
    </li>
  );
}
