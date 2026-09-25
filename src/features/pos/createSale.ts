import { batch, query } from '@/lib/db';
import { genId } from '@/lib/format';
import { DEFAULT_COMMISSION_RATE } from '@/config/constants';
import type { CommissionType, DraftSaleItem } from '@/types';

export interface CreateSaleInput {
  orgId: string;
  branchId: string;
  userId: string | null;
  customerId: string | null;
  /** Cita de origen, si la venta nace de una cita atendida. Da trazabilidad. */
  appointmentId?: string | null;
  requiresInvoice: boolean;
  items: DraftSaleItem[];
  subtotal: number;
  discountTotal: number;
  total: number;
  /**
   * Fecha del servicio (`sold_at`). Por defecto ahora. Para ventas retroactivas
   * (citas de días pasados) se pasa el día real de la cita, de modo que ventas
   * y comisiones caigan en ese día. El cobro se registra aparte, con la fecha de
   * hoy, contra la caja abierta.
   */
  soldAt?: string;
}

/**
 * Persiste una venta completa en una transacción:
 *  sale → sale_item[] → sale_service_staff[] (comisiones) → invoice_request?
 * NO registra pagos: el cobro se hace después contra la venta (venta ≠ pago).
 */
export async function createSale(input: CreateSaleInput): Promise<string> {
  const saleId = genId();
  const now = new Date().toISOString();
  const soldAt = input.soldAt ?? now;
  const saleNumber = `V-${Date.now()}`;

  const stmts: { sql: string; args: (string | number | null)[] }[] = [
    {
      sql: `INSERT INTO sale
              (id, organization_id, branch_id, customer_id, appointment_id, sale_number, sold_at,
               status, subtotal, discount_total, tax_total, total, requires_invoice, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, 0, ?, ?, ?)`,
      args: [
        saleId,
        input.orgId,
        input.branchId,
        input.customerId,
        input.appointmentId ?? null,
        saleNumber,
        soldAt,
        input.subtotal,
        input.discountTotal,
        input.total,
        input.requiresInvoice ? 1 : 0,
        input.userId,
      ],
    },
  ];

  for (const item of input.items) {
    const itemId = genId();
    const lineTotal = item.final_unit_price * item.quantity;
    stmts.push({
      sql: `INSERT INTO sale_item
              (id, sale_id, service_id, product_id, description, quantity,
               list_unit_price, discount_amount, final_unit_price, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        itemId,
        saleId,
        item.service_id,
        item.product_id,
        item.description,
        item.quantity,
        item.list_unit_price,
        item.discount_amount,
        item.final_unit_price,
        lineTotal,
      ],
    });

    // Distribución de comisiones por línea de servicio.
    for (const c of item.commissions) {
      stmts.push({
        sql: `INSERT INTO sale_service_staff
                (id, sale_item_id, staff_member_id, participation_role, commission_basis,
                 basis_amount, commission_type, commission_rate, commission_amount,
                 reduces_primary_amount)
              VALUES (?, ?, ?, ?, 'final_service_value', ?, ?, ?, ?, ?)`,
        args: [
          genId(),
          itemId,
          c.staff_member_id,
          c.participation_role,
          lineTotal,
          c.commission_type,
          c.commission_rate,
          c.commission_amount,
          c.reduces_primary_amount ? 1 : 0,
        ],
      });
    }
  }

  // Si requiere factura, crear la solicitud → aparece en el Kanban (Pendiente).
  if (input.requiresInvoice) {
    stmts.push({
      sql: `INSERT INTO invoice_request
              (id, organization_id, branch_id, sale_id, customer_id, status, requested_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      args: [
        genId(),
        input.orgId,
        input.branchId,
        saleId,
        input.customerId,
        now,
      ],
    });
  }

  await batch(stmts);
  return saleId;
}

/** Resuelve el monto de comisión según tipo (%/fijo) y base. */
export function resolveCommission(
  type: 'percentage' | 'fixed',
  rate: number,
  basis: number,
): number {
  if (type === 'percentage') return Math.round(basis * rate) / 100;
  return rate;
}

export interface CommissionRule {
  commission_type: CommissionType;
  commission_value: number;
}

/**
 * Carga las reglas de comisión vigentes por colaborador+servicio
 * (`staff_service_commission`). Devuelve un Map con clave `${staffId}:${serviceId}`.
 * Lo que no tenga regla usa el % por defecto.
 */
export async function loadCommissionRules(): Promise<Map<string, CommissionRule>> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await query<{
    staff_member_id: string;
    service_id: string;
    commission_type: CommissionType;
    commission_value: number;
  }>(
    `SELECT staff_member_id, service_id, commission_type, commission_value
       FROM staff_service_commission
      WHERE active = 1
        AND date(effective_from) <= date(?)
        AND (effective_to IS NULL OR date(effective_to) >= date(?))`,
    [today, today],
  );
  const m = new Map<string, CommissionRule>();
  for (const r of rows) {
    m.set(`${r.staff_member_id}:${r.service_id}`, {
      commission_type: r.commission_type,
      commission_value: r.commission_value,
    });
  }
  return m;
}

/**
 * Regla de comisión para un colaborador+servicio: la configurada si existe,
 * si no el % por defecto. `basis` es el valor final de la línea.
 */
export function commissionForItem(
  staffId: string,
  serviceId: string,
  basis: number,
  rules: Map<string, CommissionRule>,
): { commission_type: CommissionType; commission_rate: number; commission_amount: number } {
  const rule = rules.get(`${staffId}:${serviceId}`);
  const type = rule?.commission_type ?? 'percentage';
  const rate = rule?.commission_value ?? DEFAULT_COMMISSION_RATE;
  return {
    commission_type: type,
    commission_rate: rate,
    commission_amount: resolveCommission(type, rate, basis),
  };
}
