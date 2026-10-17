/** Un cuadre modifica el saldo, pero no representa dinero entregado. */
export const ADJUST_COMMISSION_MARK = '[Ajuste de comisión]';

export interface CommissionBalanceData {
  staff_member_id: string;
  staff_name: string;
  color: string | null;
  accrued: number;
  advances: number;
  paid: number;
  earned_week: number;
  advances_week: number;
  paid_week: number;
  adjustments_week: number;
}

export interface CommissionBalanceRow extends CommissionBalanceData {
  opening: number;
  pending: number;
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function commissionBalance(row: CommissionBalanceData): CommissionBalanceRow {
  const pending = cents(row.accrued - row.advances - row.paid);
  return {
    ...row,
    pending,
    opening: cents(pending - row.earned_week + row.advances_week + row.paid_week + row.adjustments_week),
  };
}

/** Argumentos: organización, sucursal, lunes UTC, lunes local, hoy local, ahora UTC.
 * Los adelantos guardan fecha local; ventas y pagos guardan instantes UTC.
 * El saldo histórico se conserva, mientras las columnas visibles resumen la semana.
 */
export const COMMISSION_BALANCE_SQL = `
WITH params AS (
  SELECT ? AS org_id, ? AS branch_id, ? AS week_start, ? AS week_day, ? AS today, ? AS now_at
), earned AS (
  SELECT sss.staff_member_id,
         ROUND(SUM(sss.commission_amount), 2) AS total,
         ROUND(SUM(CASE WHEN datetime(s.sold_at) >= datetime(p.week_start) THEN sss.commission_amount ELSE 0 END), 2) AS week_total
    FROM sale_service_staff sss
    JOIN sale_item si ON si.id = sss.sale_item_id
    JOIN sale s ON s.id = si.sale_id
    CROSS JOIN params p
   WHERE s.branch_id = p.branch_id AND s.status IN ('completed', 'partially_refunded')
     AND datetime(s.sold_at) <= datetime(p.now_at)
   GROUP BY sss.staff_member_id
), advances_classified AS (
  SELECT a.*,
         instr(COALESCE(a.notes, ''), '${ADJUST_COMMISSION_MARK}') > 0 AS is_adjustment,
         CASE WHEN length(a.advance_date) = 10 THEN a.advance_date >= p.week_day
              ELSE datetime(a.advance_date) >= datetime(p.week_start) END AS is_this_week
    FROM staff_advance a CROSS JOIN params p
   WHERE a.branch_id = p.branch_id AND a.status = 'confirmed'
     AND CASE WHEN length(a.advance_date) = 10 THEN a.advance_date <= p.today
              ELSE datetime(a.advance_date) <= datetime(p.now_at) END
), advances AS (
  SELECT staff_member_id, ROUND(SUM(amount), 2) AS total,
         ROUND(SUM(CASE WHEN is_this_week AND NOT is_adjustment THEN amount ELSE 0 END), 2) AS week_total,
         ROUND(SUM(CASE WHEN is_this_week AND is_adjustment THEN amount ELSE 0 END), 2) AS week_adjustments
    FROM advances_classified GROUP BY staff_member_id
), payments AS (
  SELECT sp.staff_member_id, ROUND(SUM(sp.net_paid), 2) AS total,
         ROUND(SUM(CASE WHEN datetime(sp.paid_at) >= datetime(p.week_start) THEN sp.net_paid ELSE 0 END), 2) AS week_total
    FROM staff_payment sp CROSS JOIN params p
   WHERE sp.branch_id = p.branch_id AND sp.status = 'confirmed'
     AND datetime(sp.paid_at) <= datetime(p.now_at)
   GROUP BY sp.staff_member_id
)
SELECT sm.id AS staff_member_id,
       sm.first_name || COALESCE(' ' || sm.last_name, '') AS staff_name, sm.color,
       COALESCE(e.total, 0) AS accrued, COALESCE(a.total, 0) AS advances, COALESCE(sp.total, 0) AS paid,
       COALESCE(e.week_total, 0) AS earned_week, COALESCE(a.week_total, 0) AS advances_week,
       COALESCE(sp.week_total, 0) AS paid_week, COALESCE(a.week_adjustments, 0) AS adjustments_week
  FROM staff_member sm CROSS JOIN params p
  LEFT JOIN earned e ON e.staff_member_id = sm.id
  LEFT JOIN advances a ON a.staff_member_id = sm.id
  LEFT JOIN payments sp ON sp.staff_member_id = sm.id
 WHERE sm.organization_id = p.org_id AND sm.active = 1
 ORDER BY sm.first_name`;
