import { useQuery } from '@tanstack/react-query';
import { queryOne } from '@/lib/db';
import { useBranchId } from '@/store/session';

export interface PeriodFinance {
  sales: number;
  received: number;
  expenses: number;
  profit: number; // received − expenses
}

export type PeriodKey = 'day' | 'week' | 'month';

export interface PeriodFinanceData {
  day: PeriodFinance;
  week: PeriodFinance;
  month: PeriodFinance;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Límites [start, end) locales para día, semana (lun–dom) y mes actuales. */
function bounds() {
  const now = new Date();

  const dStart = isoLocal(now);
  const dNext = new Date(now);
  dNext.setDate(now.getDate() + 1);

  const dow = (now.getDay() + 6) % 7; // 0 = lunes
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);
  const nextMon = new Date(monday);
  nextMon.setDate(monday.getDate() + 7);

  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    day: { start: dStart, end: isoLocal(dNext) },
    week: { start: isoLocal(monday), end: isoLocal(nextMon) },
    month: { start: isoLocal(mStart), end: isoLocal(mEnd) },
  };
}

async function rangeFinance(
  branchId: string,
  start: string,
  end: string,
): Promise<PeriodFinance> {
  const row = await queryOne<{
    sales: number;
    received: number;
    expenses: number;
  }>(
    `SELECT
        (SELECT COALESCE(SUM(total_sales),0) FROM v_daily_sales
          WHERE branch_id = ?1 AND day >= ?2 AND day < ?3) AS sales,
        (SELECT COALESCE(SUM(total_received),0) FROM v_daily_collections
          WHERE branch_id = ?1 AND day >= ?2 AND day < ?3) AS received,
        (SELECT COALESCE(SUM(total_expenses),0) FROM v_daily_expenses
          WHERE branch_id = ?1 AND day >= ?2 AND day < ?3) AS expenses`,
    [branchId, start, end],
  );
  const sales = row?.sales ?? 0;
  const received = row?.received ?? 0;
  const expenses = row?.expenses ?? 0;
  return { sales, received, expenses, profit: received - expenses };
}

export function usePeriodFinance() {
  const branchId = useBranchId();
  return useQuery({
    queryKey: ['period-finance', branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<PeriodFinanceData> => {
      const b = bounds();
      const [day, week, month] = await Promise.all([
        rangeFinance(branchId, b.day.start, b.day.end),
        rangeFinance(branchId, b.week.start, b.week.end),
        rangeFinance(branchId, b.month.start, b.month.end),
      ]);
      return { day, week, month };
    },
  });
}
