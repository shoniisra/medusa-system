import { genId } from '@/lib/format';
import type { Stmt } from '@/lib/db';
import type {
  RecurringFrequency,
  RecurringKind,
  RecurringTransaction,
} from '@/types';

/**
 * Avanza una fecha según la frecuencia de la recurrente. Para monthly/yearly
 * respeta `day_of_month` recortándolo al último día del mes si no existe
 * (ej. "31" en febrero → día 28/29). Para weekly/biweekly suma 7 o 14 días
 * desde la última fecha corrida.
 */
export function nextRunDate(
  current: string,
  frequency: RecurringFrequency,
  dayOfMonth: number | null,
): string {
  const d = new Date(current + 'T00:00:00');
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'biweekly') d.setDate(d.getDate() + 14);
  else if (frequency === 'monthly') {
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const target = clampDay(d.getFullYear(), d.getMonth(), dayOfMonth ?? 1);
    d.setDate(target);
  } else {
    // yearly
    d.setDate(1);
    d.setFullYear(d.getFullYear() + 1);
    const target = clampDay(d.getFullYear(), d.getMonth(), dayOfMonth ?? 1);
    d.setDate(target);
  }
  return d.toISOString().slice(0, 10);
}

function clampDay(year: number, month: number, day: number): number {
  // Último día del mes: new Date(year, month+1, 0).getDate()
  const last = new Date(year, month + 1, 0).getDate();
  return Math.min(Math.max(1, day), last);
}

/** Fecha ISO de hoy en zona local (YYYY-MM-DD). */
export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Primera fecha de ejecución según la frecuencia y `start_date`. */
export function firstRunDate(
  startDate: string,
  frequency: RecurringFrequency,
  dayOfMonth: number | null,
  weekday: number | null,
): string {
  const d = new Date(startDate + 'T00:00:00');
  if (frequency === 'weekly' || frequency === 'biweekly') {
    if (weekday != null) {
      // Avanza hasta el primer `weekday` ≥ start_date.
      const diff = (weekday - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + diff);
    }
    return d.toISOString().slice(0, 10);
  }
  // monthly / yearly: usa el día del mes si está, si no el día de start_date.
  const target = clampDay(d.getFullYear(), d.getMonth(), dayOfMonth ?? d.getDate());
  d.setDate(target);
  // Si el día del mes ya pasó dentro del mes de arranque, saltar al siguiente
  // ciclo (evita generar "atrasados" imposibles de pagar).
  if (d.toISOString().slice(0, 10) < startDate) {
    return nextRunDate(d.toISOString().slice(0, 10), frequency, dayOfMonth);
  }
  return d.toISOString().slice(0, 10);
}

export interface RecurringDraft {
  id: string | null;
  orgId: string;
  branchId: string;
  kind: RecurringKind;
  description: string;
  amount: number;
  expenseCategoryId: string | null;
  incomeReason: string | null;
  paymentMethodId: string;
  bankAccountId: string | null;
  frequency: RecurringFrequency;
  dayOfMonth: number | null;
  weekday: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
  userId: string | null;
}

export function upsertRecurringStatements(d: RecurringDraft): Stmt[] {
  const now = new Date().toISOString();
  if (d.id) {
    return [
      {
        sql: `UPDATE recurring_transaction
                 SET description=?, amount=?, expense_category_id=?, income_reason=?,
                     payment_method_id=?, bank_account_id=?,
                     frequency=?, day_of_month=?, weekday=?,
                     start_date=?, end_date=?, active=?, updated_at=?
               WHERE id = ?`,
        args: [
          d.description,
          d.amount,
          d.expenseCategoryId,
          d.incomeReason,
          d.paymentMethodId,
          d.bankAccountId,
          d.frequency,
          d.dayOfMonth,
          d.weekday,
          d.startDate,
          d.endDate,
          d.active ? 1 : 0,
          now,
          d.id,
        ],
      },
    ];
  }
  const nextRun = firstRunDate(
    d.startDate,
    d.frequency,
    d.dayOfMonth,
    d.weekday,
  );
  return [
    {
      sql: `INSERT INTO recurring_transaction
              (id, organization_id, branch_id, kind, description, amount,
               expense_category_id, income_reason, payment_method_id, bank_account_id,
               frequency, day_of_month, weekday, next_run_date, last_run_date,
               start_date, end_date, active, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      args: [
        genId(),
        d.orgId,
        d.branchId,
        d.kind,
        d.description,
        d.amount,
        d.expenseCategoryId,
        d.incomeReason,
        d.paymentMethodId,
        d.bankAccountId,
        d.frequency,
        d.dayOfMonth,
        d.weekday,
        nextRun,
        d.startDate,
        d.endDate,
        d.active ? 1 : 0,
        d.userId,
        now,
        now,
      ],
    },
  ];
}

/**
 * Instancia una recurrente: inserta la transacción real (expense o payment) y
 * avanza `next_run_date` + `last_run_date`. El UI pide confirmación por fila.
 */
export function runRecurringStatements(
  r: RecurringTransaction,
  opts: {
    cashSessionId: string | null;
    userId: string | null;
  },
): Stmt[] {
  const now = new Date().toISOString();
  const paymentDate = r.next_run_date; // La fecha nominal del movimiento.
  const isCash = r.bank_account_id == null;
  const stmts: Stmt[] = [];

  if (r.kind === 'expense') {
    const expenseId = genId();
    stmts.push({
      sql: `INSERT INTO expense
              (id, organization_id, branch_id, expense_category_id, payment_method_id,
               bank_account_id, expense_date, description, amount, status, created_by,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      args: [
        expenseId,
        r.organization_id,
        r.branch_id,
        r.expense_category_id,
        r.payment_method_id,
        r.bank_account_id,
        paymentDate,
        `[Recurrente] ${r.description}`,
        r.amount,
        r.created_by ?? opts.userId,
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
          opts.cashSessionId,
          r.branch_id,
          r.amount,
          now,
          expenseId,
          `[Recurrente] ${r.description}`,
          opts.userId,
        ],
      });
    }
  } else {
    // income
    const paymentId = genId();
    const label = `[Recurrente] ${r.income_reason ?? 'Ingreso'} · ${r.description}`;
    stmts.push({
      sql: `INSERT INTO payment
              (id, organization_id, branch_id, sale_id, payment_method_id,
               bank_account_id, paid_at, amount, status, reference, created_by)
            VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'confirmed', ?, ?)`,
      args: [
        paymentId,
        r.organization_id,
        r.branch_id,
        r.payment_method_id,
        r.bank_account_id,
        now,
        r.amount,
        label,
        opts.userId,
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
          opts.cashSessionId,
          r.branch_id,
          r.amount,
          now,
          paymentId,
          label,
          opts.userId,
        ],
      });
    }
  }

  const advanced = nextRunDate(r.next_run_date, r.frequency, r.day_of_month);
  // Si tiene end_date y el próximo cae después, se desactiva.
  const willEnd = r.end_date && advanced > r.end_date;
  stmts.push({
    sql: `UPDATE recurring_transaction
             SET next_run_date = ?, last_run_date = ?, active = ?, updated_at = ?
           WHERE id = ?`,
    args: [advanced, paymentDate, willEnd ? 0 : r.active, now, r.id],
  });

  return stmts;
}

export const FREQUENCY_LABEL: Record<RecurringFrequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
  yearly: 'Anual',
};

export const WEEKDAY_LABEL = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const;
