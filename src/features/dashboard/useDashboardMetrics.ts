import { useQuery } from '@tanstack/react-query';
import { query, queryOne } from '@/lib/db';
import { todayISO, toLocalNaive } from '@/lib/format';
import { useBranchId } from '@/store/session';
import {
  hoursForDate,
  freeIntervals,
  toMinutes,
  fromMinutes,
  type Interval,
} from '@/config/schedule';

export interface MonthFinance {
  sales: number;
  received: number;
  cash: number;
  transfer: number;
  card: number;
  expenses: number;
}

export interface NextAppointment {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  customer_name: string | null;
  phone: string | null;
  services: string | null;
}

export interface SellerRank {
  staff_member_id: string;
  name: string;
  revenue: number;
  commission: number;
}

export interface CustomerRank {
  customer_id: string;
  name: string;
  spent: number;
  visits: number;
}

export interface StylistAvailability {
  staff_member_id: string;
  name: string;
  intervals: { label: string }[];
  closed: boolean;
}

export interface DashboardMetrics {
  month: MonthFinance;
  todayAttended: number;
  todayPending: number;
  nextAppointments: NextAppointment[];
  topSeller: SellerRank | null;
  sellers: SellerRank[];
  topCustomers: CustomerRank[];
  noShowRate: number; // %
  noShowCount: number;
  monthAppointments: number;
  availability: StylistAvailability[];
}

function monthBounds() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m + 1)}-01`;
  const end = m === 11 ? `${y + 1}-01-01` : `${y}-${pad(m + 2)}-01`;
  return { start, end };
}

export function useDashboardMetrics() {
  const branchId = useBranchId();
  const day = todayISO();

  return useQuery({
    queryKey: ['dashboard-metrics', branchId, day],
    enabled: !!branchId,
    queryFn: async (): Promise<DashboardMetrics> => {
      const { start, end } = monthBounds();

      const [
        salesRow,
        collRow,
        expRow,
        todayCounts,
        nextAppointments,
        sellers,
        topCustomers,
        noShow,
        stylists,
        bookedToday,
      ] = await Promise.all([
        queryOne<{ total: number }>(
          `SELECT COALESCE(SUM(total_sales),0) AS total FROM v_daily_sales
            WHERE branch_id = ? AND day >= ? AND day < ?`,
          [branchId, start, end],
        ),
        queryOne<{
          received: number;
          cash: number;
          transfer: number;
          card: number;
        }>(
          `SELECT COALESCE(SUM(total_received),0) AS received,
                  COALESCE(SUM(cash_received),0) AS cash,
                  COALESCE(SUM(transfer_received),0) AS transfer,
                  COALESCE(SUM(card_received),0) AS card
             FROM v_daily_collections
            WHERE branch_id = ? AND day >= ? AND day < ?`,
          [branchId, start, end],
        ),
        queryOne<{ total: number }>(
          `SELECT COALESCE(SUM(total_expenses),0) AS total FROM v_daily_expenses
            WHERE branch_id = ? AND day >= ? AND day < ?`,
          [branchId, start, end],
        ),
        query<{ status: string; n: number }>(
          `SELECT status, COUNT(*) AS n FROM appointment
            WHERE branch_id = ? AND date(start_at) = ? GROUP BY status`,
          [branchId, day],
        ),
        query<NextAppointment>(
          `SELECT a.id, a.start_at, a.end_at, a.status,
                  c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS customer_name,
                  c.phone,
                  (SELECT GROUP_CONCAT(ai.description, ', ')
                     FROM appointment_item ai WHERE ai.appointment_id = a.id) AS services
             FROM appointment a
             LEFT JOIN customer c ON c.id = a.customer_id
            WHERE a.branch_id = ? AND a.start_at >= ?
              AND a.status IN ('reserved','confirmed')
            ORDER BY a.start_at ASC LIMIT 4`,
          [branchId, toLocalNaive(new Date())],
        ),
        query<SellerRank>(
          `SELECT sss.staff_member_id AS staff_member_id,
                  sm.first_name || CASE WHEN sm.last_name IS NOT NULL THEN ' ' || sm.last_name ELSE '' END AS name,
                  ROUND(SUM(CASE WHEN sss.participation_role='primary' THEN sss.basis_amount ELSE 0 END),2) AS revenue,
                  ROUND(SUM(sss.commission_amount),2) AS commission
             FROM sale s
             JOIN sale_item si ON si.sale_id = s.id
             JOIN sale_service_staff sss ON sss.sale_item_id = si.id
             JOIN staff_member sm ON sm.id = sss.staff_member_id
            WHERE s.branch_id = ? AND s.status IN ('completed','partially_refunded')
              AND date(s.sold_at) >= ? AND date(s.sold_at) < ?
            GROUP BY sss.staff_member_id
            ORDER BY revenue DESC LIMIT 5`,
          [branchId, start, end],
        ),
        query<CustomerRank>(
          `SELECT c.id AS customer_id,
                  c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS name,
                  ROUND(SUM(s.total),2) AS spent,
                  COUNT(*) AS visits
             FROM sale s
             JOIN customer c ON c.id = s.customer_id
            WHERE s.branch_id = ? AND s.status IN ('completed','partially_refunded')
            GROUP BY c.id
            ORDER BY spent DESC LIMIT 5`,
          [branchId],
        ),
        queryOne<{ no_shows: number; total: number }>(
          `SELECT SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) AS no_shows,
                  COUNT(*) AS total
             FROM appointment
            WHERE branch_id = ? AND date(start_at) >= ? AND date(start_at) < ?`,
          [branchId, start, end],
        ),
        query<{ id: string; name: string }>(
          `SELECT sm.id AS id,
                  sm.first_name || CASE WHEN sm.last_name IS NOT NULL THEN ' ' || sm.last_name ELSE '' END AS name
             FROM staff_member sm
             JOIN staff_branch sb ON sb.staff_member_id = sm.id
            WHERE sb.branch_id = ? AND sm.active = 1 AND sb.active = 1
            ORDER BY sm.first_name`,
          [branchId],
        ),
        query<{ staff_id: string; start_at: string; end_at: string }>(
          `SELECT ai.assigned_staff_id AS staff_id, a.start_at, a.end_at
             FROM appointment a
             JOIN appointment_item ai ON ai.appointment_id = a.id
            WHERE a.branch_id = ? AND date(a.start_at) = ?
              AND ai.assigned_staff_id IS NOT NULL
              AND a.status IN ('reserved','confirmed','attended')`,
          [branchId, day],
        ),
      ]);

      // Conteos de hoy.
      const attended =
        todayCounts.find((r) => r.status === 'attended')?.n ?? 0;
      const pending = todayCounts
        .filter((r) => r.status === 'reserved' || r.status === 'confirmed')
        .reduce((a, r) => a + r.n, 0);

      // Disponibilidad de hoy por estilista.
      const hours = hoursForDate(day);
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const bookedByStaff = new Map<string, Interval[]>();
      for (const b of bookedToday) {
        const arr = bookedByStaff.get(b.staff_id) ?? [];
        arr.push({
          startMin: toMinutes(b.start_at.slice(11, 16)),
          endMin: toMinutes(b.end_at.slice(11, 16)),
        });
        bookedByStaff.set(b.staff_id, arr);
      }
      const availability: StylistAvailability[] = stylists.map((st) => {
        const free = freeIntervals(
          hours,
          bookedByStaff.get(st.id) ?? [],
          nowMin,
        );
        return {
          staff_member_id: st.id,
          name: st.name,
          closed: !hours,
          intervals: free.map((i) => ({
            label: `${fromMinutes(i.startMin)}–${fromMinutes(i.endMin)}`,
          })),
        };
      });

      return {
        month: {
          sales: salesRow?.total ?? 0,
          received: collRow?.received ?? 0,
          cash: collRow?.cash ?? 0,
          transfer: collRow?.transfer ?? 0,
          card: collRow?.card ?? 0,
          expenses: expRow?.total ?? 0,
        },
        todayAttended: attended,
        todayPending: pending,
        nextAppointments,
        topSeller: sellers[0] ?? null,
        sellers,
        topCustomers,
        noShowRate: noShow?.total
          ? Math.round(((noShow.no_shows ?? 0) / noShow.total) * 1000) / 10
          : 0,
        noShowCount: noShow?.no_shows ?? 0,
        monthAppointments: noShow?.total ?? 0,
        availability,
      };
    },
  });
}
