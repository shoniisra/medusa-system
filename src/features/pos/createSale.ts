import { batch } from '@/lib/db';
import { genId } from '@/lib/format';
import type { DraftSaleItem } from '@/types';

export interface CreateSaleInput {
  orgId: string;
  branchId: string;
  userId: string | null;
  customerId: string | null;
  requiresInvoice: boolean;
  items: DraftSaleItem[];
  subtotal: number;
  discountTotal: number;
  total: number;
}

/**
 * Persiste una venta completa en una transacción:
 *  sale → sale_item[] → sale_service_staff[] (comisiones) → invoice_request?
 * NO registra pagos: el cobro se hace después contra la venta (venta ≠ pago).
 */
export async function createSale(input: CreateSaleInput): Promise<string> {
  const saleId = genId();
  const now = new Date().toISOString();
  const saleNumber = `V-${Date.now()}`;

  const stmts: { sql: string; args: (string | number | null)[] }[] = [
    {
      sql: `INSERT INTO sale
              (id, organization_id, branch_id, customer_id, sale_number, sold_at,
               status, subtotal, discount_total, tax_total, total, requires_invoice, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, 0, ?, ?, ?)`,
      args: [
        saleId,
        input.orgId,
        input.branchId,
        input.customerId,
        saleNumber,
        now,
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
