import { useQuery } from '@tanstack/react-query';
import { queryOne } from '@/lib/db';
import { qk } from '@/lib/queryClient';
import { todayISO } from '@/lib/format';
import { useBranchId } from '@/store/session';
import type {
  CashSession,
  VDailyCollections,
  VDailyExpenses,
  VDailySales,
} from '@/types';

export interface DashboardData {
  sales: VDailySales | null;
  collections: VDailyCollections | null;
  expenses: VDailyExpenses | null;
  cashSession: CashSession | null;
  cashExpected: number; // apertura + entradas efectivo - salidas efectivo
}

/** Métricas del día para la sucursal activa. Todo filtra por branch + día. */
export function useDashboard(day: string = todayISO()) {
  const branchId = useBranchId();

  return useQuery({
    queryKey: qk.dashboard(branchId, day),
    enabled: !!branchId,
    queryFn: async (): Promise<DashboardData> => {
      const [sales, collections, expenses, cashSession] = await Promise.all([
        queryOne<VDailySales>(
          'SELECT * FROM v_daily_sales WHERE branch_id = ? AND day = ?',
          [branchId, day],
        ),
        queryOne<VDailyCollections>(
          'SELECT * FROM v_daily_collections WHERE branch_id = ? AND day = ?',
          [branchId, day],
        ),
        queryOne<VDailyExpenses>(
          'SELECT * FROM v_daily_expenses WHERE branch_id = ? AND day = ?',
          [branchId, day],
        ),
        queryOne<CashSession>(
          `SELECT cs.* FROM cash_session cs
             JOIN cash_register cr ON cr.id = cs.cash_register_id
            WHERE cr.branch_id = ? AND cs.status = 'open'
            ORDER BY cs.opened_at DESC LIMIT 1`,
          [branchId],
        ),
      ]);

      // Efectivo esperado en caja = apertura + movimientos de efectivo de la sesión.
      let cashExpected = 0;
      if (cashSession) {
        const row = await queryOne<{ net: number }>(
          `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS net
             FROM cash_movement
            WHERE cash_session_id = ?`,
          [cashSession.id],
        );
        cashExpected = cashSession.opening_cash + (row?.net ?? 0);
      }

      return {
        sales,
        collections,
        expenses,
        cashSession,
        cashExpected,
      };
    },
  });
}
