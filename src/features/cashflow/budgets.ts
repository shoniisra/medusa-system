import { genId } from '@/lib/format';
import type { Stmt } from '@/lib/db';
import { ADJUST_MARK } from './cashSessionActions';

export interface BudgetRow {
  id: string | null;
  expense_category_id: string;
  category_name: string;
  period_month: string;
  amount: number;
  spent: number;
}

/**
 * SQL del listado de presupuestos del mes: trae todas las categorías activas
 * de la organización, LEFT JOIN con el presupuesto del mes y suma lo gastado
 * desde `expense` (ignorando ajustes y anulados). Devuelve una fila por
 * categoría aunque no tenga presupuesto cargado (id=NULL, amount=0).
 */
export const BUDGET_MONTH_SQL = `
SELECT b.id AS id,
       ec.id AS expense_category_id,
       ec.name AS category_name,
       ? AS period_month,
       COALESCE(b.amount, 0) AS amount,
       COALESCE(sp.s, 0) AS spent
  FROM expense_category ec
  LEFT JOIN budget b
    ON b.expense_category_id = ec.id
   AND b.branch_id = ?
   AND b.period_month = ?
  LEFT JOIN (
    SELECT expense_category_id, SUM(amount) AS s
      FROM expense
     WHERE branch_id = ?
       AND status <> 'voided'
       AND substr(expense_date, 1, 7) = ?
       AND COALESCE(description,'') NOT LIKE '${ADJUST_MARK}%'
     GROUP BY expense_category_id
  ) sp ON sp.expense_category_id = ec.id
 WHERE ec.organization_id = ?
   AND ec.active = 1
 ORDER BY ec.name
`;

export function upsertBudgetStatements(d: {
  id: string | null;
  orgId: string;
  branchId: string;
  categoryId: string;
  periodMonth: string;
  amount: number;
  note: string | null;
  userId: string | null;
}): Stmt[] {
  const now = new Date().toISOString();
  if (d.id) {
    return [
      {
        sql: `UPDATE budget
                 SET amount = ?, note = ?, updated_at = ?
               WHERE id = ?`,
        args: [d.amount, d.note, now, d.id],
      },
    ];
  }
  return [
    {
      sql: `INSERT INTO budget
              (id, organization_id, branch_id, expense_category_id,
               period_month, amount, note, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        genId(),
        d.orgId,
        d.branchId,
        d.categoryId,
        d.periodMonth,
        d.amount,
        d.note,
        d.userId,
        now,
        now,
      ],
    },
  ];
}

/** Nivel de alerta a partir del uso de un presupuesto. */
export function budgetTone(spent: number, amount: number): 'ok' | 'warn' | 'danger' {
  if (amount <= 0) return 'ok';
  const ratio = spent / amount;
  if (ratio >= 1) return 'danger';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}
