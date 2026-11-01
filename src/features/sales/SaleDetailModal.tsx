import { AuditHistoryLink } from '@/features/audit/AuditHistoryLink';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, HandHelping, Maximize2, Trash2 } from 'lucide-react';
import { batch, execute, query, queryOne, type Stmt } from '@/lib/db';
import { dateShort, genId, money, timeShort } from '@/lib/format';
import { invalidateFinance } from '@/lib/queryClient';
import { ROUTES } from '@/config/constants';
import { useBranchId, useSession } from '@/store/session';
import { hasPermission } from '@/config/permissions';
import { Badge, Button, Modal, Select, useToast } from '@/components/ui';
import { useOpenCashSession } from '@/features/cashflow/accounts';
import { useStaff, useAssignableStaff } from '@/features/pos/useCatalog';
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
  /** Qué ayuda fue, cuando el rol es `assistant`. */
  assist_label: string | null;
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
  /** Movimiento de caja generado por el cobro (solo si fue en efectivo). */
  movement_id: string | null;
  /** Estado de la caja donde entró el efectivo: abierta o ya cerrada. */
  session_status: string | null;
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
              sss.commission_amount, sss.assist_label
         FROM sale_service_staff sss
         JOIN sale_item si ON si.id = sss.sale_item_id
        WHERE si.sale_id = ?
        ORDER BY sss.participation_role`,
      [head.id],
    ),
    query<SalePaymentRow>(
      `SELECT p.id, p.amount, p.paid_at, p.reference, p.appointment_id,
              pm.method_type, ba.name AS bank_name,
              cm.id AS movement_id, cs.status AS session_status,
              u.full_name AS created_by_name
         FROM payment p
         JOIN payment_method pm ON pm.id = p.payment_method_id
         LEFT JOIN bank_account ba ON ba.id = p.bank_account_id
         LEFT JOIN cash_movement cm ON cm.payment_id = p.id
         LEFT JOIN cash_session cs ON cs.id = cm.cash_session_id
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
  const assignableStaff = useAssignableStaff();
  const [voidPayment, setVoidPayment] = useState<SalePaymentRow | null>(null);

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
  const canSeeCommissions = useSession((s) =>
    hasPermission(s.user?.role, 'view_commissions'),
  );
  // Anular un cobro mueve dinero y caja: lo habilita quien opera caja.
  const canVoidPayments = useSession((s) =>
    hasPermission(s.user?.role, 'use_cash_register'),
  );
  const userId = useSession((s) => s.user?.id ?? null);

  // Si el modal se abrió por una cita (o la venta pertenece a una), ofrecemos
  // ir a la ficha completa de la cita con un botón de "ampliar". Es el reemplazo
  // visual del viejo botón "Ver" del menú de acciones.
  const openAppointmentId = sale?.head.appointment_id ?? appointmentId ?? null;
  const openFullAppointment = openAppointmentId
    ? () => {
        onClose();
        navigate(`${ROUTES.appointment}/${openAppointmentId}`);
      }
    : null;

  return (
    <Modal open onClose={onClose} title={title} className="sm:max-w-xl">
      {sale && <div className="mb-3"><AuditHistoryLink entityType="sale" id={sale.head.id} /></div>}
      {openFullAppointment && (
        <div className="-mt-2 mb-3 flex justify-end">
          <button
            type="button"
            onClick={openFullAppointment}
            title="Ver detalle en pantalla completa"
            className="tap inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-white/80 hover:border-gold-400/50 hover:text-gold-200"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Ampliar
          </button>
        </div>
      )}
      {data.isLoading ? (
        <p className="py-6 text-center text-sm text-white/50">Cargando venta…</p>
      ) : !sale ? (
        <p className="py-6 text-center text-sm text-white/50">
          {appointmentId
            ? 'Esta cita todavía no tiene venta registrada.'
            : 'No se encontró la venta.'}
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
          </div>

          {/* Líneas + colaboradoras */}
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
              Detalle
            </h3>
            <ul className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-white/[0.02]">
              {sale.items.map((it) => {
                const rows = sale.staff.filter((r) => r.sale_item_id === it.id);
                const primaryRows = rows.filter(
                  (r) => r.participation_role === 'primary',
                );
                const assistRows = rows.filter(
                  (r) => r.participation_role === 'assistant',
                );
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

                    {isService && (
                      <>
                        {primaryRows.length === 0 ? (
                          <StaffPicker
                            label="Sin colaboradora"
                            value=""
                            disabled={!editable || changeStaff.isPending}
                            staff={assignableStaff.data ?? []}
                            onChange={(staffId) =>
                              changeStaff.mutate({ item: it, row: null, staffId })
                            }
                          />
                        ) : (
                          primaryRows.map((r) => (
                            <StaffPicker
                              key={r.id}
                              label={ROLE_LABEL[r.participation_role]}
                              value={r.staff_member_id}
                              hint={
                                canSeeCommissions
                                  ? `Comisión ${money(r.commission_amount)}`
                                  : undefined
                              }
                              disabled={!editable || changeStaff.isPending}
                              staff={assignableStaff.data ?? []}
                              fallbackName={staffName(r.staff_member_id)}
                              onChange={(staffId) =>
                                changeStaff.mutate({ item: it, row: r, staffId })
                              }
                            />
                          ))
                        )}
                        {/* Ayudas: solo lectura (se registran al vender; su monto
                            ya se restó del principal). */}
                        {assistRows.map((r) => (
                          <div
                            key={r.id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white/[0.03] px-2.5 py-1.5 text-sm"
                          >
                            <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gold-200/70">
                              <HandHelping className="h-3.5 w-3.5" /> Ayuda
                            </span>
                            <span className="text-white/80">
                              {r.assist_label ?? 'Asistencia'}
                            </span>
                            <span className="text-white/50">
                              {staffName(r.staff_member_id)}
                            </span>
                            {canSeeCommissions && (
                              <span className="ml-auto text-white/60">
                                Comisión {money(r.commission_amount)}
                              </span>
                            )}
                          </div>
                        ))}
                      </>
                    )}
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
                    <span className="flex items-start gap-3">
                      <span className="whitespace-nowrap text-right text-[11px] text-white/40">
                        {dateShort(p.paid_at)} · {timeShort(p.paid_at)}
                        {p.created_by_name ? (
                          <span className="block">{p.created_by_name}</span>
                        ) : null}
                      </span>
                      {editable && canVoidPayments && (
                        <button
                          type="button"
                          onClick={() => setVoidPayment(p)}
                          title="Anular este cobro"
                          className="tap mt-0.5 shrink-0 text-white/40 hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {editable && canVoidPayments && sale.payments.length > 0 && (
              <p className="mt-1.5 text-[11px] text-white/35">
                Si un cobro se cargó mal o duplicado, anulalo: la venta queda con
                saldo pendiente y lo recobrás con el monto correcto desde
                Flujo → «Cobros / abonos».
              </p>
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
      {voidPayment && sale && (
        <VoidPaymentModal
          payment={voidPayment}
          saleNumber={sale.head.sale_number}
          branchId={branchId}
          userId={userId}
          onClose={() => setVoidPayment(null)}
          onDone={() => {
            setVoidPayment(null);
            toast.success('Cobro anulado', 'La venta quedó con saldo pendiente.');
            refresh();
          }}
        />
      )}
    </Modal>
  );
}

/**
 * Anula UN cobro de una venta (mal cargado o duplicado), sin descuadrar la caja:
 *  - el `payment` pasa a "voided", deja de contar como ingreso y la venta queda
 *    con saldo pendiente (se recobra con el monto correcto desde «Cobros / abonos»);
 *  - si el cobro fue en efectivo y su caja sigue abierta, se borra el
 *    `cash_movement` (la caja esperada baja sin dejar un movimiento fantasma);
 *  - si esa caja ya se cerró, se revierte con una salida en la caja abierta de hoy;
 *  - si fue a una cuenta bancaria, alcanza con anular el pago.
 */
function VoidPaymentModal({
  payment,
  saleNumber,
  branchId,
  userId,
  onClose,
  onDone,
}: {
  payment: SalePaymentRow;
  saleNumber: string;
  branchId: string;
  userId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState('');
  const cash = useOpenCashSession(branchId);
  const sessionId = cash.data?.id ?? null;

  const inOpenCash = !!payment.movement_id && payment.session_status === 'open';
  const inClosedCash = !!payment.movement_id && payment.session_status !== 'open';
  const blocked = inClosedCash && !sessionId;

  const voidIt = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      const stmts: Stmt[] = [
        { sql: `UPDATE payment SET status = 'voided' WHERE id = ?`, args: [payment.id] },
      ];
      if (inOpenCash) {
        stmts.push({
          sql: 'DELETE FROM cash_movement WHERE id = ?',
          args: [payment.movement_id],
        });
      } else if (inClosedCash && sessionId) {
        stmts.push({
          sql: `INSERT INTO cash_movement
                  (id, cash_session_id, branch_id, movement_type, direction, amount,
                   movement_at, payment_id, description, created_by)
                VALUES (?, ?, ?, 'adjustment', 'out', ?, ?, ?, ?, ?)`,
          args: [
            genId(),
            sessionId,
            branchId,
            payment.amount,
            now,
            payment.id,
            `Anulación cobro ${saleNumber}`,
            userId,
          ],
        });
      }
      await batch(stmts);
    },
    onSuccess: onDone,
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'No se pudo anular el cobro.'),
  });

  return (
    <Modal open onClose={onClose} title="Anular cobro">
      <div className="space-y-4">
        <div className="rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>
              {dateShort(payment.paid_at)} ·{' '}
              {payment.bank_name ??
                (payment.method_type === 'cash' ? 'Efectivo' : payment.method_type)}
            </span>
            <span className="kpi-gold">{money(payment.amount)}</span>
          </div>
          {payment.reference && (
            <p className="mt-1 truncate text-xs text-white/40">{payment.reference}</p>
          )}
        </div>

        <p className="text-sm text-white/70">
          Este cobro deja de contar como ingreso y la venta queda con{' '}
          {money(payment.amount)} de saldo pendiente, que podés recobrar con el
          monto correcto desde Flujo → «Cobros / abonos».
          {inOpenCash && ' También se quita el efectivo de la caja abierta.'}
          {inClosedCash &&
            ' El efectivo entró en una caja ya cerrada: se revierte con una salida en la caja de hoy.'}
        </p>

        {blocked && (
          <p className="flex items-center gap-1.5 text-xs text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5" /> El cobro fue en efectivo de
            una caja ya cerrada y no hay caja abierta. Abrí la caja para poder
            revertir el efectivo.
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            variant="danger"
            disabled={voidIt.isPending || blocked}
            loading={voidIt.isPending}
            onClick={() => {
              setError('');
              voidIt.mutate();
            }}
          >
            Anular cobro
          </Button>
        </div>
      </div>
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
