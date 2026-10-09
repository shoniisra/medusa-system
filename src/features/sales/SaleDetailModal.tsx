import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { execute, query, queryOne } from '@/lib/db';
import { dateShort, genId, money, timeShort } from '@/lib/format';
import { invalidateFinance } from '@/lib/queryClient';
import { ROUTES } from '@/config/constants';
import { useBranchId } from '@/store/session';
import { Badge, Modal, Select, useToast } from '@/components/ui';
import { useStaff } from '@/features/pos/useCatalog';
import { customerNameSql } from '@/features/clients/customerNameSql';
import { commissionForItem, loadCommissionRules } from '@/features/pos/createSale';
import type { ParticipationRole, SaleStatus } from '@/types';

interface SaleHead {
  id: string;
  sale_number: string;
  sold_at: string;
  status: SaleStatus;
  subtotal: number;
  discount_total: number;
  total: number;
  requires_invoice: number;
  appointment_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  created_by_name: string | null;
}

interface SaleItemRow {
  id: string;
  service_id: string | null;
  product_id: string | null;
  description: string;
  quantity: number;
  final_unit_price: number;
  line_total: number;
}

interface SaleStaffRow {
  id: string;
  sale_item_id: string;
  staff_member_id: string;
  participation_role: ParticipationRole;
  commission_amount: number;
}

interface SalePaymentRow {
  id: string;
  amount: number;
  paid_at: string;
  reference: string | null;
  bank_name: string | null;
  method_type: string;
  created_by_name: string | null;
  /** Pago atado también a la cita = abono/seña cobrado antes del servicio. */
  appointment_id: string | null;
}

const SALE_STATUS: Record<SaleStatus, { label: string; tone: 'success' | 'danger' | 'muted' | 'gold' }> = {
  draft: { label: 'Borrador', tone: 'muted' },
  completed: { label: 'Completada', tone: 'success' },
  voided: { label: 'Anulada', tone: 'danger' },
  refunded: { label: 'Reembolsada', tone: 'danger' },
  partially_refunded: { label: 'Reembolso parcial', tone: 'gold' },
};

const ROLE_LABEL: Record<ParticipationRole, string> = {
  primary: 'Responsable',
  assistant: 'Asistente',
};

/** Carga cabecera, líneas, colaboradoras por línea y cobros de una venta. */
async function loadSale(saleId: string | null, appointmentId: string | null) {
  const head = saleId
    ? await queryOne<SaleHead>(
        `SELECT s.id, s.sale_number, s.sold_at, s.status, s.subtotal, s.discount_total,
                s.total, s.requires_invoice, s.appointment_id, s.customer_id,
                ${customerNameSql()} AS customer_name,
                u.full_name AS created_by_name
           FROM sale s
           LEFT JOIN customer c ON c.id = s.customer_id
           LEFT JOIN app_user u ON u.id = s.created_by
          WHERE s.id = ?`,
        [saleId],
      )
    : await queryOne<SaleHead>(
        `SELECT s.id, s.sale_number, s.sold_at, s.status, s.subtotal, s.discount_total,
                s.total, s.requires_invoice, s.appointment_id, s.customer_id,
                ${customerNameSql()} AS customer_name,
                u.full_name AS created_by_name
           FROM sale s
           LEFT JOIN customer c ON c.id = s.customer_id
           LEFT JOIN app_user u ON u.id = s.created_by
          WHERE s.appointment_id = ? AND s.status <> 'voided'
          ORDER BY s.created_at DESC LIMIT 1`,
        [appointmentId],
      );
  if (!head) return null;
  const [items, staff, payments] = await Promise.all([
    query<SaleItemRow>(
      `SELECT id, service_id, product_id, description, quantity, final_unit_price, line_total
         FROM sale_item WHERE sale_id = ? ORDER BY rowid`,
      [head.id],
    ),
    query<SaleStaffRow>(
      `SELECT sss.id, sss.sale_item_id, sss.staff_member_id, sss.participation_role,
              sss.commission_amount
         FROM sale_service_staff sss
         JOIN sale_item si ON si.id = sss.sale_item_id
        WHERE si.sale_id = ?
        ORDER BY sss.participation_role`,
      [head.id],
    ),
    query<SalePaymentRow>(
      `SELECT p.id, p.amount, p.paid_at, p.reference, p.appointment_id,
              pm.method_type, ba.name AS bank_name,
              u.full_name AS created_by_name
         FROM payment p
         JOIN payment_method pm ON pm.id = p.payment_method_id
         LEFT JOIN bank_account ba ON ba.id = p.bank_account_id
         LEFT JOIN app_user u ON u.id = p.created_by
        WHERE p.sale_id = ? AND p.status = 'confirmed'
        ORDER BY p.paid_at`,
      [head.id],
    ),
  ]);
  return { head, items, staff, payments };
}

/**
 * Detalle de una venta (POS o de cita): líneas, quién hizo cada servicio, cobros
 * y totales. Desde acá se corrige la colaboradora de una línea cuando se cargó
 * mal: la comisión de esa línea se recalcula con la regla de la nueva persona y
 * el saldo de comisiones de ambas se mueve solo (se calcula desde esta tabla).
 *
 * Se abre por `saleId` (Finanzas, Historial, POS) o por `appointmentId`
 * (ficha de cita atendida: la venta vigente de esa cita).
 */
export function SaleDetailModal({
  saleId = null,
  appointmentId = null,
  onClose,
}: {
  saleId?: string | null;
  appointmentId?: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const branchId = useBranchId();
  const staffList = useStaff();

  const data = useQuery({
    queryKey: ['sale-detail', saleId, appointmentId],
    enabled: !!(saleId || appointmentId),
    queryFn: () => loadSale(saleId, appointmentId),
  });

  const sale = data.data ?? null;
  const editable = sale?.head.status === 'completed' || sale?.head.status === 'partially_refunded';

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['sale-detail'] });
    void qc.invalidateQueries({ queryKey: ['attention-history'] });
    void qc.invalidateQueries({ queryKey: ['customer-history'] });
    invalidateFinance(qc, branchId);
  };

  // Cambiar (o asignar) la colaboradora de una línea de servicio. La comisión se
  // recalcula con la regla vigente de la nueva persona para ese servicio.
  const changeStaff = useMutation({
    mutationFn: async (p: {
      item: SaleItemRow;
      row: SaleStaffRow | null;
      staffId: string;
    }) => {
      if (!p.item.service_id) throw new Error('Solo las líneas de servicio llevan colaboradora.');
      const rules = await loadCommissionRules();
      const c = commissionForItem(p.staffId, p.item.service_id, p.item.line_total, rules);
      if (p.row) {
        await execute(
          `UPDATE sale_service_staff
              SET staff_member_id = ?, commission_type = ?, commission_rate = ?,
                  commission_amount = ?
            WHERE id = ?`,
          [p.staffId, c.commission_type, c.commission_rate, c.commission_amount, p.row.id],
        );
      } else {
        await execute(
          `INSERT INTO sale_service_staff
             (id, sale_item_id, staff_member_id, participation_role, commission_basis,
              basis_amount, commission_type, commission_rate, commission_amount,
              reduces_primary_amount)
           VALUES (?, ?, ?, 'primary', 'final_service_value', ?, ?, ?, ?, 0)`,
          [
            genId(),
            p.item.id,
            p.staffId,
            p.item.line_total,
            c.commission_type,
            c.commission_rate,
            c.commission_amount,
          ],
        );
      }
      await execute('UPDATE sale SET updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        sale!.head.id,
      ]);
    },
    onSuccess: () => {
      toast.success('Colaboradora actualizada', 'La comisión de la línea se recalculó.');
      refresh();
    },
    onError: (e: Error) => toast.error('No se pudo cambiar', e.message),
  });

  const staffName = (id: string) => {
    const s = (staffList.data ?? []).find((m) => m.id === id);
    return s ? `${s.first_name}${s.last_name ? ` ${s.last_name}` : ''}` : id;
  };

  const title = sale ? `Venta ${sale.head.sale_number}` : 'Venta';
  const paid = sale?.payments.reduce((a, p) => a + p.amount, 0) ?? 0;

  return (
    <Modal open onClose={onClose} title={title} className="sm:max-w-xl">
      {data.isLoading ? (
        <p className="py-6 text-center text-sm text-white/50">Cargando venta…</p>
      ) : !sale ? (
        <p className="py-6 text-center text-sm text-white/50">
          No se encontró la venta.
        </p>
      ) : (
        <div className="space-y-5">
          {/* Cabecera */}
          <div className="space-y-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-white">
                {sale.head.customer_name?.trim() || 'Consumidor final'}
              </span>
              <Badge tone={SALE_STATUS[sale.head.status].tone}>
                {SALE_STATUS[sale.head.status].label}
              </Badge>
              <Badge tone={sale.head.appointment_id ? 'info' : 'gold'}>
                {sale.head.appointment_id ? 'Cita' : 'POS'}
              </Badge>
            </div>
            <p className="text-xs text-white/50">
              {dateShort(sale.head.sold_at)} · {timeShort(sale.head.sold_at)}
              {sale.head.created_by_name ? ` · registró ${sale.head.created_by_name}` : ''}
              {sale.head.requires_invoice ? ' · con factura' : ''}
            </p>
            {sale.head.appointment_id && (
              <button
                onClick={() => {
                  onClose();
                  navigate(`${ROUTES.appointment}/${sale.head.appointment_id}`);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-gold-300 hover:underline"
              >
                Abrir cita <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Líneas + colaboradoras */}
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
              Detalle
            </h3>
            <ul className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-white/[0.02]">
              {sale.items.map((it) => {
                const rows = sale.staff.filter((r) => r.sale_item_id === it.id);
                const isService = !!it.service_id;
                return (
                  <li key={it.id} className="space-y-2 px-3 py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-white">{it.description}</span>
                        <span className="block text-xs text-white/40">
                          {it.quantity} × {money(it.final_unit_price)}
                          {isService ? '' : ' · producto'}
                        </span>
                      </span>
                      <span className="whitespace-nowrap font-medium text-white">
                        {money(it.line_total)}
                      </span>
                    </div>

                    {isService &&
                      (rows.length === 0 ? (
                        <StaffPicker
                          label="Sin colaboradora"
                          value=""
                          disabled={!editable || changeStaff.isPending}
                          staff={staffList.data ?? []}
                          onChange={(staffId) =>
                            changeStaff.mutate({ item: it, row: null, staffId })
                          }
                        />
                      ) : (
                        rows.map((r) => (
                          <StaffPicker
                            key={r.id}
                            label={ROLE_LABEL[r.participation_role]}
                            value={r.staff_member_id}
                            hint={`Comisión ${money(r.commission_amount)}`}
                            disabled={!editable || changeStaff.isPending}
                            staff={staffList.data ?? []}
                            fallbackName={staffName(r.staff_member_id)}
                            onChange={(staffId) =>
                              changeStaff.mutate({ item: it, row: r, staffId })
                            }
                          />
                        ))
                      ))}
                  </li>
                );
              })}
            </ul>
            {editable && sale.items.some((i) => i.service_id) && (
              <p className="mt-1.5 text-[11px] text-white/35">
                Si se cargó mal quién hizo el servicio, elegí la persona correcta: la
                comisión de esa línea pasa a su nombre.
              </p>
            )}
          </section>

          {/* Cobros */}
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
              Cobros
            </h3>
            {sale.payments.length === 0 ? (
              <p className="text-sm text-white/50">Sin cobros registrados.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {sale.payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span className="font-semibold text-white">{money(p.amount)}</span>
                        {p.appointment_id && <Badge tone="info">Abono</Badge>}
                      </span>
                      <span className="block text-xs text-white/50">
                        {p.bank_name ?? (p.method_type === 'cash' ? 'Efectivo' : p.method_type)}
                        {p.reference ? ` · ${p.reference}` : ''}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-right text-[11px] text-white/40">
                      {dateShort(p.paid_at)} · {timeShort(p.paid_at)}
                      {p.created_by_name ? (
                        <span className="block">{p.created_by_name}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Totales */}
          <div className="space-y-1.5 border-t border-white/10 pt-3 text-sm">
            <Row label="Subtotal" value={money(sale.head.subtotal)} />
            {sale.head.discount_total > 0 && (
              <Row label="Descuentos" value={`−${money(sale.head.discount_total)}`} />
            )}
            <Row label="Total" value={money(sale.head.total)} strong />
            <Row
              label="Cobrado"
              value={money(paid)}
              tone={paid + 0.005 >= sale.head.total ? 'success' : 'danger'}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-medium text-white/80' : 'text-white/60'}>{label}</span>
      <span
        className={
          tone === 'success'
            ? 'font-medium text-success'
            : tone === 'danger'
              ? 'font-medium text-danger'
              : strong
                ? 'font-semibold text-white'
                : 'text-white'
        }
      >
        {value}
      </span>
    </div>
  );
}

/** Selector de colaboradora de una línea, con rol y comisión actual. */
function StaffPicker({
  label,
  value,
  hint,
  disabled,
  staff,
  fallbackName,
  onChange,
}: {
  label: string;
  value: string;
  hint?: string;
  disabled: boolean;
  staff: { id: string; first_name: string; last_name: string | null }[];
  fallbackName?: string;
  onChange: (staffId: string) => void;
}) {
  // Si la persona asignada ya no está activa, igual tiene que verse su nombre.
  const known = staff.some((s) => s.id === value);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white/[0.03] px-2.5 py-1.5">
      <span className="text-[11px] uppercase tracking-wide text-white/40">{label}</span>
      <div className="min-w-[180px] flex-1">
        <Select
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            if (next && next !== value) onChange(next);
          }}
        >
          <option value="">Elegir colaboradora…</option>
          {!known && value && (
            <option value={value}>{fallbackName ?? value} (inactiva)</option>
          )}
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.first_name}
              {s.last_name ? ` ${s.last_name}` : ''}
            </option>
          ))}
        </Select>
      </div>
      {hint && <span className="text-xs text-white/50">{hint}</span>}
    </div>
  );
}
