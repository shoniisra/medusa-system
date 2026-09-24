import { useQuery } from '@tanstack/react-query';
import { query } from '@/lib/db';
import { useBranchId } from '@/store/session';

export interface MonthBar {
  month: string; // 'YYYY-MM'
  label: string; // 'ene', 'feb', …
  sales: number;
}

const MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** Ventas de los últimos 6 meses (incluye el actual), para el gráfico de barras. */
export function useMonthlySales() {
  const branchId = useBranchId();
  return useQuery({
    queryKey: ['monthly-sales', branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<MonthBar[]> => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const pad = (n: number) => String(n).padStart(2, '0');
      const fromStr = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-01`;

      const rows = await query<{ ym: string; total: number }>(
        `SELECT substr(day,1,7) AS ym, COALESCE(SUM(total_sales),0) AS total
           FROM v_daily_sales
          WHERE branch_id = ? AND day >= ?
          GROUP BY ym`,
        [branchId, fromStr],
      );
      const map = new Map(rows.map((r) => [r.ym, r.total]));

      const out: MonthBar[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        out.push({
          month: ym,
          label: MONTHS[d.getMonth()],
          sales: map.get(ym) ?? 0,
        });
      }
      return out;
    },
  });
}
