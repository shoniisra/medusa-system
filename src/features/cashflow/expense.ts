import { genId, todayISO } from '@/lib/format';
import type { Stmt } from '@/lib/db';

export type ExpenseDraft = {
  orgId: string;
  branchId: string;
  expenseCategoryId: string;
  paymentMethodId: string;
  /** Cuenta bancaria, o `null` cuando el egreso sale de la caja física. */
  bankAccountId: string | null;
  /** Sesión de caja abierta; obligatoria si `bankAccountId` es `null`. */
  cashSessionId: string | null;
  description: string;
  amount: number;
  /** Autor del movimiento; `null` si la sesión no lo tiene resuelto. */
  userId: string | null;
};

/**
 * Sentencias de un egreso confirmado: la fila de `expense` y, cuando sale de la
 * caja física, el `cash_movement` que la descuenta.
 *
 * Estaban copiadas en tres pantallas (egreso de Flujo, pago de comisiones y
 * adelanto de sueldo). Que el movimiento de caja dependa de `bankAccountId` en
 * un solo lugar evita el bug clásico: registrar el egreso en efectivo y olvidar
 * descontarlo de la caja, con lo que el cierre nunca cuadra.
 */
export function expenseStatements(d: ExpenseDraft): Stmt[] {
  const expenseId = genId();
  // Sin cuenta bancaria el egreso sale de la caja. Normalizar acá evita el caso
  // torcido de guardar `bank_account_id = ''` y a la vez no mover la caja.
  const bankAccountId = d.bankAccountId || null;
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO expense
              (id, organization_id, branch_id, expense_category_id, payment_method_id,
               bank_account_id, expense_date, description, amount, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
      args: [
        expenseId,
        d.orgId,
        d.branchId,
        d.expenseCategoryId,
        d.paymentMethodId,
        bankAccountId,
        todayISO(),
        d.description,
        d.amount,
        d.userId,
      ],
    },
  ];

  if (!bankAccountId) {
    stmts.push({
      sql: `INSERT INTO cash_movement
              (id, cash_session_id, branch_id, movement_type, direction, amount,
               movement_at, expense_id, description, created_by)
            VALUES (?, ?, ?, 'expense', 'out', ?, ?, ?, ?, ?)`,
      args: [
        genId(),
        d.cashSessionId,
        d.branchId,
        d.amount,
        new Date().toISOString(),
        expenseId,
        d.description,
        d.userId,
      ],
    });
  }

  return stmts;
}
