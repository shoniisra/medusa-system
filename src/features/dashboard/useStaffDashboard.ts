import { useQuery } from '@tanstack/react-query';
import { query, queryOne } from '@/lib/db';
import { todayISO, toLocalNaive } from '@/lib/format';
import { ymd } from '@/lib/date';
import { useBranchId, useOrgId, useSession } from '@/store/session';
import type { NextAppointment } from './useDashboardMetrics';

export interface StaffCommissions {
  today: number;
  week: number;
  month: number;
}

export interface StaffBalance {
  /** Comisiones acumuladas (histórico, hasta ahora). */
  accrued: number;
  /** Adelantos confirmados (histórico). */
  advances: number;
  /** Pagos de comisión confirmados (histórico). */
  paid: number;
  /** Lo que la salón aún le debe: accrued − advances − paid. */
  pending: number;
  /** Retirado en el mes actual = adelantos + pagos del mes. */
  withdrawnMonth: number;
}

export interface StaffAppointmentCounts {
  today: number;
  week: number;
}

export interface StaffServiceRow {
  sale_id: string;
  sold_at: string;
  sale_number: string;
  sale_status: string;
  description: string;
  quantity: number;
  line_total: number;
  participation_role: 'primary' | 'assistant';
  commission_amount: number;
  assist_label: string | null;
  customer_name: string | null;
}

export interface StaffDashboard {
  staff: { id: string; name: string } | null;
  commissions: StaffCommissions;
  balance: StaffBalance;
  appointmentCounts: StaffAppointmentCounts;
  nextAppointments: NextAppointment[];
  servicesToday: StaffServiceRow[];
}

const EMPTY_RESULT: Omit<StaffDashboard, 'staff'> = {
  commissions: { today: 0, week: 0, month: 0 },
  balance: {
    accrued: 0,
    advances: 0,
    paid: 0,
    pending: 0,
    withdrawnMonth: 0,
  },
  appointmentCounts: { today: 0, week: 0 },
  nextAppointments: [],
  servicesToday: [],
};

/** Lunes de la semana que contiene `d`, en hora local. */
function weekStartISO(d: Date): string {
  const monday = new Date(d);
  const dow = (monday.getDay() + 6) % 7; // 0 = lunes
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - dow);
  return ymd(monday);
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const nd = new Date(y, m - 1, d + delta);
  return ymd(nd);
}

function monthStartISO(d: Date): string {
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
}

function nextMonthStartISO(d: Date): string {
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1));
}

/**
 * Resuelve el `staff_member` del usuario autenticado y arma el panel personal:
 * ingresos (comisiones) de hoy/semana/mes, saldo a favor acumulado, retirado
 * del mes, conteos de citas y la lista de sus próximas citas asignadas.
 */
export function useStaffDashboard() {
  const userId = useSession((s) => s.user?.id ?? null);
  const orgId = useOrgId();
  const branchId = useBranchId();

  return useQuery({
    queryKey: ['staff-dashboard', userId, orgId, branchId, todayISO()],
    enabled: !!userId && !!orgId && !!branchId,
    queryFn: async (): Promise<StaffDashboard> => {
      const staff = await queryOne<{ id: string; name: string }>(
        `SELECT id,
                first_name || CASE WHEN last_name IS NOT NULL THEN ' ' || last_name ELSE '' END AS name
           FROM staff_member
          WHERE app_user_id = ? AND organization_id = ? AND active = 1
          LIMIT 1`,
        [userId!, orgId],
      );

      if (!staff) {
        return { staff: null, ...EMPTY_RESULT };
      }

      const now = new Date();
      const today = todayISO();
      const weekStart = weekStartISO(now);
      const weekEnd = addDaysISO(weekStart, 7);
      const monthStart = monthStartISO(now);
      const monthEnd = nextMonthStartISO(now);
      const nowIso = now.toISOString();

      const [
        commissions,
        accruedRow,
        advancesRow,
        paymentsRow,
        apptCountsRow,
        nextAppointments,
        servicesToday,
      ] = await Promise.all([
        queryOne<{ today: number; week: number; month: number }>(
          `SELECT
             ROUND(SUM(CASE WHEN date(s.sold_at,'localtime') = ?
                            THEN sss.commission_amount ELSE 0 END), 2) AS today,
             ROUND(SUM(CASE WHEN date(s.sold_at,'localtime') >= ?
                             AND date(s.sold_at,'localtime') < ?
                            THEN sss.commission_amount ELSE 0 END), 2) AS week,
             ROUND(SUM(CASE WHEN date(s.sold_at,'localtime') >= ?
                             AND date(s.sold_at,'localtime') < ?
                            THEN sss.commission_amount ELSE 0 END), 2) AS month
             FROM sale_service_staff sss
             JOIN sale_item si ON si.id = sss.sale_item_id
             JOIN sale s ON s.id = si.sale_id
            WHERE sss.staff_member_id = ?
              AND s.branch_id = ?
              AND s.status IN ('completed','partially_refunded')`,
          [
            today,
            weekStart,
            weekEnd,
            monthStart,
            monthEnd,
            staff.id,
            branchId,
          ],
        ),
        queryOne<{ total: number }>(
          `SELECT ROUND(SUM(sss.commission_amount), 2) AS total
             FROM sale_service_staff sss
             JOIN sale_item si ON si.id = sss.sale_item_id
             JOIN sale s ON s.id = si.sale_id
            WHERE sss.staff_member_id = ?
              AND s.branch_id = ?
              AND s.status IN ('completed','partially_refunded')
              AND s.sold_at <= ?`,
          [staff.id, branchId, nowIso],
        ),
        queryOne<{ total: number; month: number }>(
          `SELECT COALESCE(SUM(amount), 0) AS total,
                  COALESCE(SUM(CASE WHEN date(advance_date,'localtime') >= ?
                                     AND date(advance_date,'localtime') < ?
                                    THEN amount ELSE 0 END), 0) AS month
             FROM staff_advance
            WHERE staff_member_id = ? AND branch_id = ? AND status = 'confirmed'`,
          [monthStart, monthEnd, staff.id, branchId],
        ),
        queryOne<{ total: number; month: number }>(
          `SELECT COALESCE(SUM(net_paid), 0) AS total,
                  COALESCE(SUM(CASE WHEN date(paid_at,'localtime') >= ?
                                     AND date(paid_at,'localtime') < ?
                                    THEN net_paid ELSE 0 END), 0) AS month
             FROM staff_payment
            WHERE staff_member_id = ? AND branch_id = ? AND status = 'confirmed'`,
          [monthStart, monthEnd, staff.id, branchId],
        ),
        queryOne<{ today: number; week: number }>(
          `SELECT
             COUNT(DISTINCT CASE WHEN date(a.start_at) = ?
                                 THEN a.id END) AS today,
             COUNT(DISTINCT CASE WHEN date(a.start_at) >= ?
                                  AND date(a.start_at) < ?
                                 THEN a.id END) AS week
             FROM appointment a
             JOIN appointment_item ai ON ai.appointment_id = a.id
            WHERE a.branch_id = ?
              AND ai.assigned_staff_id = ?
              AND a.status IN ('reserved','confirmed','attended')`,
          [today, weekStart, weekEnd, branchId, staff.id],
        ),
        query<NextAppointment>(
          `SELECT DISTINCT a.id, a.start_at, a.end_at, a.status, a.customer_id,
                  c.first_name || CASE WHEN c.last_name IS NOT NULL
                                       THEN ' ' || c.last_name ELSE '' END AS customer_name,
                  c.phone,
                  (SELECT GROUP_CONCAT(ai2.description, ', ')
                     FROM appointment_item ai2
                    WHERE ai2.appointment_id = a.id
                      AND ai2.assigned_staff_id = ?) AS services
             FROM appointment a
             JOIN appointment_item ai ON ai.appointment_id = a.id
             LEFT JOIN customer c ON c.id = a.customer_id
            WHERE a.branch_id = ?
              AND ai.assigned_staff_id = ?
              AND a.start_at >= ?
              AND a.status IN ('reserved','confirmed')
            ORDER BY a.start_at ASC
            LIMIT 5`,
          [staff.id, branchId, staff.id, toLocalNaive(now)],
        ),
        query<StaffServiceRow>(
          `SELECT s.id        AS sale_id,
                  s.sold_at,
                  s.sale_number,
                  s.status    AS sale_status,
                  si.description,
                  si.quantity,
                  si.line_total,
                  sss.participation_role,
                  sss.commission_amount,
                  sss.assist_label,
                  CASE
                    WHEN c.nickname IS NOT NULL THEN c.nickname
                    WHEN c.first_name IS NOT NULL
                      THEN c.first_name || COALESCE(' ' || c.last_name, '')
                    ELSE 'Consumidor Final'
                  END AS customer_name
             FROM sale_service_staff sss
             JOIN sale_item si ON si.id = sss.sale_item_id
             JOIN sale s       ON s.id  = si.sale_id
             LEFT JOIN customer c ON c.id = s.customer_id
            WHERE sss.staff_member_id = ?
              AND s.branch_id = ?
              AND s.status != 'voided'
              AND date(s.sold_at, 'localtime') = date('now', 'localtime')
            ORDER BY s.sold_at ASC`,
          [staff.id, branchId],
        ),
      ]);

      const accrued = accruedRow?.total ?? 0;
      const advancesTotal = advancesRow?.total ?? 0;
      const paymentsTotal = paymentsRow?.total ?? 0;
      const withdrawnMonth =
        (advancesRow?.month ?? 0) + (paymentsRow?.month ?? 0);

      return {
        staff,
        commissions: {
          today: commissions?.today ?? 0,
          week: commissions?.week ?? 0,
          month: commissions?.month ?? 0,
        },
        balance: {
          accrued,
          advances: advancesTotal,
          paid: paymentsTotal,
          pending:
            Math.round((accrued - advancesTotal - paymentsTotal) * 100) / 100,
          withdrawnMonth: Math.round(withdrawnMonth * 100) / 100,
        },
        appointmentCounts: {
          today: apptCountsRow?.today ?? 0,
          week: apptCountsRow?.week ?? 0,
        },
        nextAppointments,
        servicesToday,
      };
    },
  });
}
