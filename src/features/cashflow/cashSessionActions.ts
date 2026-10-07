import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  batch,
  execute,
  queryOne,
  type Stmt,
} from '@/lib/db';
import { genId, todayISO } from '@/lib/format';
import { ymd } from '@/lib/date';
import { qk, invalidateFinance } from '@/lib/queryClient';
import { useSession } from '@/store/session';
import type { CashRegister, CashSession } from '@/types';

/**
 * Lado "sin UI" del módulo de caja: queries, cálculos y mutaciones reutilizables
 * entre la página de Finanzas, el modal del Topbar y el guard diario.
 *
 * Mantener esto fuera de los componentes evita que cada boca de entrada
 * reimplemente el flujo (ajuste por descuadre + retiro + batch).
 */

/** Marca de un ajuste de saldo: cuenta para el saldo pero se excluye del P&L. */
export const ADJUST_MARK = '[Ajuste de saldo]';

export interface CashCtx {
  branchId: string;
  orgId: string;
  userId: string | null;
}

/** Última sesión de la sucursal (abierta o cerrada), para decidir el guard diario. */
export function useLatestCashSession(branchId: string) {
  return useQuery({
    queryKey: ['latest-cash', branchId],
    enabled: !!branchId,
    queryFn: () =>
      queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ?
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      ),
    refetchOnWindowFocus: true,
  });
}

/** Caja registradora activa de la sucursal (hay una por local). */
export function useCashRegister(branchId: string) {
  return useQuery({
    queryKey: ['cash-register', branchId],
    enabled: !!branchId,
    queryFn: () =>
      queryOne<CashRegister>(
        'SELECT * FROM cash_register WHERE branch_id = ? AND active = 1 ORDER BY name LIMIT 1',
        [branchId],
      ),
  });
}

/** Efectivo que quedó en caja al cerrar la última sesión (fondo de vueltos). */
export function useCashCarryover(branchId: string, enabled = true) {
  return useQuery({
    queryKey: ['cash-carryover', branchId],
    enabled: enabled && !!branchId,
    queryFn: async () => {
      const row = await queryOne<{ left_cash: number }>(
        `SELECT cs.opening_cash
                + COALESCE((SELECT SUM(CASE WHEN direction='in' THEN amount ELSE -amount END)
                              FROM cash_movement WHERE cash_session_id = cs.id),0) AS left_cash
           FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'closed'
          ORDER BY cs.closed_at DESC
          LIMIT 1`,
        [branchId],
      );
      return row?.left_cash ?? 0;
    },
  });
}

/** Esperado = apertura + neto de movimientos de la sesión. */
export function useExpectedCash(session: CashSession | null) {
  return useQuery({
    queryKey: ['cash-expected', session?.id ?? ''],
    enabled: !!session,
    queryFn: async () => {
      const row = await queryOne<{ net: number }>(
        `SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS net
           FROM cash_movement WHERE cash_session_id = ?`,
        [session!.id],
      );
      return (session!.opening_cash ?? 0) + (row?.net ?? 0);
    },
  });
}

/** ¿`opened_at` cae en el mismo día local que `today`? */
export function isOpenedToday(session: CashSession | null, today = ymd(new Date())): boolean {
  if (!session) return false;
  return ymd(new Date(session.opened_at)) === today;
}

/** Mutación: abrir caja con `opening` como fondo inicial. */
export function useOpenCashMutation(
  ctx: CashCtx,
  registerId: string | null,
  onDone?: (session: CashSession) => void,
) {
  const qc = useQueryClient();
  const setCashSession = useSession((s) => s.setCashSession);
  return useMutation({
    mutationFn: async (opening: number): Promise<CashSession> => {
      if (!registerId) throw new Error('La sucursal no tiene caja registradora.');
      const id = genId();
      const openedAt = new Date().toISOString();
      await execute(
        `INSERT INTO cash_session (id, cash_register_id, opened_by, opened_at, opening_cash, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
        [id, registerId, ctx.userId, openedAt, opening],
      );
      return {
        id,
        cash_register_id: registerId,
        opened_by: ctx.userId,
        opened_at: openedAt,
        opening_cash: opening,
        closed_by: null,
        closed_at: null,
        expected_cash: null,
        counted_cash: null,
        difference: null,
        status: 'open',
        notes: null,
      };
    },
    onSuccess: (session) => {
      setCashSession(session);
      void qc.invalidateQueries({ queryKey: qk.cashSession(ctx.branchId) });
      void qc.invalidateQueries({ queryKey: ['latest-cash', ctx.branchId] });
      void qc.invalidateQueries({ queryKey: ['open-cash', ctx.branchId] });
      invalidateFinance(qc, ctx.branchId);
      onDone?.(session);
    },
  });
}

export interface CloseCashInput {
  counted: number;
  withdraw: number;
  destination: string | null;
}

/**
 * Arma el batch de cierre de caja (sin ejecutarlo). Función pura: la lógica de
 * orden de sentencias es la invariante que valida el trigger
 * `trg_cash_session_validate_close`, así que la exportamos para poder testearla
 * sin armar un mock del cliente de DB. El `now` entra como parámetro para que
 * los tests sean deterministas.
 *
 * El UPDATE va PRIMERO: el trigger (BEFORE UPDATE) exige
 * `expected_cash == opening + SUM(in) - SUM(out)` y debe correr contra los
 * movimientos originales — antes del ajuste y del retiro. Los INSERT posteriores
 * no disparan el trigger (incidente del 2026-10-07).
 */
export function buildCloseCashStatements(
  ctx: CashCtx,
  sessionId: string,
  expected: number,
  { counted, withdraw, destination }: CloseCashInput,
  now: string,
): { stmts: Stmt[]; difference: number } {
  const difference = counted - expected;
  const stmts: Stmt[] = [
    {
      sql: `UPDATE cash_session
               SET status='closed', closed_by=?, closed_at=?,
                   expected_cash=?, counted_cash=?, difference=?
             WHERE id = ?`,
      args: [ctx.userId, now, expected, counted, difference, sessionId],
    },
  ];

  if (difference !== 0) {
    stmts.push({
      sql: `INSERT INTO cash_movement
              (id, cash_session_id, branch_id, movement_type, direction, amount,
               movement_at, description, created_by)
            VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?, ?)`,
      args: [
        genId(),
        sessionId,
        ctx.branchId,
        difference > 0 ? 'in' : 'out',
        Math.abs(difference),
        now,
        `${ADJUST_MARK} Cierre de caja`,
        ctx.userId,
      ],
    });
  }

  if (withdraw > 0 && destination) {
    stmts.push({
      sql: `INSERT INTO account_transfer
              (id, organization_id, branch_id, transfer_date, amount,
               from_kind, from_bank_account_id, to_kind, to_bank_account_id,
               cash_session_id, description, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, 'cash', NULL, 'bank', ?, ?, ?, ?, ?)`,
      args: [
        genId(),
        ctx.orgId,
        ctx.branchId,
        todayISO(),
        withdraw,
        destination,
        sessionId,
        'Retiro de caja al cierre',
        ctx.userId,
        now,
      ],
    });
    stmts.push({
      sql: `INSERT INTO cash_movement
              (id, cash_session_id, branch_id, movement_type, direction, amount,
               movement_at, description, created_by)
            VALUES (?, ?, ?, 'cash_out', 'out', ?, ?, ?, ?)`,
      args: [
        genId(),
        sessionId,
        ctx.branchId,
        withdraw,
        now,
        'Retiro de caja al cierre',
        ctx.userId,
      ],
    });
  }

  return { stmts, difference };
}

/** Mutación: cerrar caja — ajuste por descuadre + retiro + update de la sesión. */
export function useCloseCashMutation(
  ctx: CashCtx,
  session: CashSession | null,
  expected: number,
  onDone?: () => void,
) {
  const qc = useQueryClient();
  const setCashSession = useSession((s) => s.setCashSession);
  return useMutation({
    mutationFn: async (input: CloseCashInput) => {
      if (!session) throw new Error('No hay caja abierta.');
      const now = new Date().toISOString();
      const { stmts, difference } = buildCloseCashStatements(
        ctx,
        session.id,
        expected,
        input,
        now,
      );
      await batch(stmts);
      return {
        closedAt: now,
        counted: input.counted,
        withdraw: input.withdraw,
        difference,
      };
    },
    onSuccess: () => {
      setCashSession(null);
      void qc.invalidateQueries({ queryKey: qk.cashSession(ctx.branchId) });
      void qc.invalidateQueries({ queryKey: ['latest-cash', ctx.branchId] });
      void qc.invalidateQueries({ queryKey: ['open-cash', ctx.branchId] });
      invalidateFinance(qc, ctx.branchId);
      onDone?.();
    },
  });
}

/** Métricas del día (ventas, gastos, retiro, saldo) para el resumen post-cierre. */
export interface DayCashMetrics {
  salesCount: number;
  salesTotal: number;
  cashReceived: number;
  bankReceived: number;
  expenses: number;
  withdrawnToBank: number;
  openingCash: number;
  countedCash: number;
  expectedCash: number;
  difference: number;
  attended: number;
  pending: number;
}

/**
 * Devuelve las métricas del día cerrado (basadas en la sesión que acabamos de
 * cerrar). Pensadas para el modal "resumen del día".
 */
export function useDayMetricsForSession(sessionId: string | null, branchId: string, day: string | null) {
  return useQuery({
    queryKey: ['day-metrics', sessionId ?? '', day ?? ''],
    enabled: !!sessionId && !!day && !!branchId,
    queryFn: async (): Promise<DayCashMetrics> => {
      const [sessRow, movCash, movBank, exp, salesRow, apts, withdrawn] =
        await Promise.all([
          queryOne<{
            opening_cash: number;
            counted_cash: number | null;
            expected_cash: number | null;
            difference: number | null;
          }>(
            `SELECT opening_cash, counted_cash, expected_cash, difference
               FROM cash_session WHERE id = ?`,
            [sessionId!],
          ),
          queryOne<{ s: number }>(
            `SELECT COALESCE(SUM(amount),0) AS s
               FROM cash_movement
              WHERE cash_session_id = ? AND movement_type IN ('sale','cash_in')
                AND direction = 'in'`,
            [sessionId!],
          ),
          queryOne<{ s: number }>(
            `SELECT COALESCE(SUM(p.amount),0) AS s
               FROM payment p
              WHERE p.branch_id = ? AND p.status = 'confirmed'
                AND date(p.paid_at) = ?
                AND p.bank_account_id IS NOT NULL
                AND COALESCE(p.reference,'') NOT LIKE '${ADJUST_MARK}%'`,
            [branchId, day!],
          ),
          queryOne<{ s: number }>(
            `SELECT COALESCE(SUM(amount),0) AS s FROM expense
              WHERE branch_id = ? AND status <> 'voided' AND expense_date = ?
                AND COALESCE(description,'') NOT LIKE '${ADJUST_MARK}%'`,
            [branchId, day!],
          ),
          queryOne<{ n: number; total: number }>(
            `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM sale
              WHERE branch_id = ? AND status IN ('completed','partially_refunded')
                AND date(sold_at) = ?`,
            [branchId, day!],
          ),
          queryOne<{ attended: number; pending: number }>(
            `SELECT SUM(CASE WHEN status='attended' THEN 1 ELSE 0 END) AS attended,
                    SUM(CASE WHEN status IN ('reserved','confirmed') THEN 1 ELSE 0 END) AS pending
               FROM appointment
              WHERE branch_id = ? AND date(start_at) = ?`,
            [branchId, day!],
          ),
          queryOne<{ s: number }>(
            `SELECT COALESCE(SUM(amount),0) AS s
               FROM account_transfer
              WHERE cash_session_id = ? AND from_kind = 'cash'`,
            [sessionId!],
          ),
        ]);

      return {
        salesCount: salesRow?.n ?? 0,
        salesTotal: salesRow?.total ?? 0,
        cashReceived: movCash?.s ?? 0,
        bankReceived: movBank?.s ?? 0,
        expenses: exp?.s ?? 0,
        withdrawnToBank: withdrawn?.s ?? 0,
        openingCash: sessRow?.opening_cash ?? 0,
        countedCash: sessRow?.counted_cash ?? 0,
        expectedCash: sessRow?.expected_cash ?? 0,
        difference: sessRow?.difference ?? 0,
        attended: apts?.attended ?? 0,
        pending: apts?.pending ?? 0,
      };
    },
  });
}
