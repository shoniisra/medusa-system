import { CustomerCareCard } from '@/features/clients/CustomerCareCard';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Lock,
  Pencil,
  UserRound,
} from 'lucide-react';
import { batch, execute, queryOne, type Stmt } from '@/lib/db';
import {
  PaymentTargetFields,
  usePaymentTarget,
} from '@/features/cashflow/accounts';
import { searchCustomers } from '@/features/clients/customerSearch';
import { CustomerPicker } from '@/features/clients/CustomerPicker';
import { QuickCustomerModal } from '@/features/clients/QuickCustomerModal';
import {
  useCustomerCredit,
  creditBalance,
  storeCreditMethod,
  invalidateCredit,
} from '@/features/clients/customerCredit';
import { genId, money, customerName, fullName } from '@/lib/format';
import { useSession, useBranchId, useOrgId } from '@/store/session';
import { hasPermission } from '@/config/permissions';
import { usePosDraft } from '@/store/posDraft';
import {
  useCustomers,
  useServices,
  useProducts,
  useAssignableStaff,
  useAssistTypes,
} from './useCatalog';
import { useCategorySkills } from '@/features/staff/useCategorySkills';
import {
  SaleItemsEditor,
  commissionByStaff,
  type EditorItem,
} from './SaleItemsEditor';
import {
  createSale,
  loadCommissionRules,
  commissionForItem,
} from './createSale';
import {
  findCustomerByPhone,
  phoneOwner,
} from '@/features/clients/customerLookup';
import {
  fillCustomerGaps,
  gapFillSummary,
  renamedName,
  type CustomerPatch,
} from '@/features/clients/mergeCustomers';
import { validatePhone } from '@/lib/phone';
import { CONSUMIDOR_FINAL_LABEL } from '@/config/constants';
import { invalidateCustomers, invalidateSales } from '@/lib/queryClient';
import {
  Button,
  Card,
  CardHeader,
  Input,
  Modal,
  Badge,
  useToast,
  DetailRow,
} from '@/components/ui';
import type {
  Customer,
  DraftCommission,
  DraftSaleItem,
  Product,
  Service,
} from '@/types';

/**
 * POS: venta sin cita. Misma mecánica que "Atención de cita" (buscar cliente,
 * agregar servicios/productos con el mismo editor, comisiones al colaborador y
 * cobro), pero sin cita en calendario ni abono. La venta se arma en el borrador
 * en memoria y se persiste al confirmar.
 */
export function NewSaleTab() {
  const orgId = useOrgId();
  const branchId = useBranchId();
  const qc = useQueryClient();
  const toast = useToast();

  const draft = usePosDraft();
  const services = useServices();
  const products = useProducts();
  const staff = useAssignableStaff();
  const assistTypes = useAssistTypes();

  // Cliente (mostrador por defecto): buscar existente o crear al vuelo.
  const [customerId, setCustomerId] = useState('');
  const [newClient, setNewClient] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const customers = useCustomers();
  const searchRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [moreDataOpen, setMoreDataOpen] = useState(false);

  const selectedCustomer = customers.data?.find((c) => c.id === customerId);

  const clientMatches = useMemo(
    () => searchCustomers(customers.data ?? [], clientSearch),
    [customers.data, clientSearch],
  );

  // Dueño del número tipeado para el cliente nuevo: el teléfono es único, así
  // que conviene avisarlo acá y ofrecer esa ficha, y no fallar al cobrar.
  const phoneTaken = useMemo(
    () => (newClient ? phoneOwner(customers.data ?? [], phone) : null),
    [newClient, customers.data, phone],
  );

  function pickExisting(c: { id: string }) {
    setCustomerId(c.id);
    setNewClient(false);
    setClientSearch('');
  }
  function startNewClient() {
    const parts = clientSearch.trim().split(/\s+/).filter(Boolean);
    setFirstName(parts[0] ?? '');
    setLastName(parts.slice(1).join(' '));
    setNewClient(true);
    setCustomerId('');
    setTimeout(() => phoneRef.current?.focus(), 0);
  }

  /** Lo escrito en el alta rápida, en la forma en que se guarda. */
  const typedPatch: CustomerPatch = {
    first_name: firstName.trim(),
    last_name: lastName.trim() || null,
    phone: phone.trim() || null,
  };

  /** Nombre que quedaría en la ficha del número repetido si se la usa. */
  const renameTo = phoneTaken ? renamedName(phoneTaken, typedPatch) : null;

  /**
   * El número ya tiene ficha: se usa esa para la venta y se le pone el nombre
   * que se acaba de escribir (el viejo baja a alias, ver `fillCustomerGaps`).
   * La fila se relee porque `phoneTaken` sale del cache de clientes.
   */
  const useExistingClient = useMutation({
    mutationFn: async () => {
      if (!phoneTaken) return null;
      const row = await queryOne<Customer>(
        'SELECT * FROM customer WHERE id = ?',
        [phoneTaken.id],
      );
      if (!row) throw new Error('Esa ficha ya no existe. Recargá la pantalla.');
      const gap = fillCustomerGaps(row, typedPatch);
      if (gap) await batch([gap.stmt]);
      return gap;
    },
    onSuccess: (gap) => {
      invalidateCustomers(qc, orgId);
      pickExisting(phoneTaken!);
      toast.success(
        `Ficha de ${gap?.renamedFrom ? renameTo : customerName(phoneTaken!)}`,
        gapFillSummary(gap),
      );
    },
    onError: (e: Error) =>
      toast.error('No se pudo usar ese contacto', e.message),
  });
  function clearClient() {
    setNewClient(false);
    setCustomerId('');
    setFirstName('');
    setLastName('');
    setPhone('');
    setClientSearch('');
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  // Reglas de comisión vigentes: mismo cálculo que al confirmar la venta.
  const commissionRules = useQuery({
    queryKey: ['commission-rules', orgId],
    enabled: !!orgId,
    queryFn: () => loadCommissionRules(),
  });
  const rules = commissionRules.data;

  // Especialidades: al agregar un servicio, si no se eligió estilista, se
  // preselecciona la de la categoría del servicio (ej. Color → Lesly).
  const { defaultStaffForCategory } = useCategorySkills();

  // Borrador → filas del editor compartido (estilista con nombre/color).
  const staffById = useMemo(
    () => new Map((staff.data ?? []).map((s) => [s.id, s])),
    [staff.data],
  );
  const editorItems: EditorItem[] = useMemo(
    () =>
      draft.items.map((i) => {
        const s = i.assigned_staff_id
          ? staffById.get(i.assigned_staff_id)
          : null;
        return {
          id: i.tempId,
          service_id: i.service_id,
          product_id: i.product_id,
          category: null,
          description: i.description,
          quantity: i.quantity,
          list_unit_price: i.list_unit_price,
          discount_amount: i.discount_amount,
          final_unit_price: i.final_unit_price,
          assigned_staff_id: i.assigned_staff_id,
          staff_name: s ? fullName(s.first_name, s.last_name) : null,
          staff_color: s?.color ?? null,
          assists: i.assists,
        };
      }),
    [draft.items, staffById],
  );

  const staffCommissions = commissionByStaff(editorItems, rules);
  const totalCommission = staffCommissions.reduce((a, s) => a + s.amount, 0);
  const canSeeCommissions = useSession((s) =>
    hasPermission(s.user?.role, 'view_commissions'),
  );

  const total = draft.total();
  const subtotal = draft.subtotal();
  const discountTotal = draft.discountTotal();
  const totalServicios = draft.items
    .filter((i) => i.service_id)
    .reduce((a, i) => a + i.final_unit_price * i.quantity, 0);
  const totalProductos = draft.items
    .filter((i) => i.product_id)
    .reduce((a, i) => a + i.final_unit_price * i.quantity, 0);

  // Vendibles reales (todo el borrador lo es: no hay filas de sola categoría).
  const canConfirm = draft.items.length > 0 && !phoneTaken;

  function onAddService({
    sid,
    stid,
    service,
  }: {
    sid: string;
    stid: string | null;
    service?: Service;
  }) {
    const s = service ?? services.data?.find((x) => x.id === sid);
    if (!s) return;
    // Estilista explícita si se eligió; si no, la de la categoría del servicio.
    const assigned = stid || defaultStaffForCategory(s.category) || null;
    draft.addItem({
      service_id: s.id,
      product_id: null,
      description: s.name,
      quantity: 1,
      list_unit_price: s.base_price,
      discount_amount: 0,
      final_unit_price: s.base_price,
      assigned_staff_id: assigned,
    });
  }
  function onAddProduct({
    pid,
    qty,
    product,
  }: {
    pid: string;
    qty: number;
    product?: Product;
  }) {
    const p = product ?? products.data?.find((x) => x.id === pid);
    if (!p) return;
    draft.addItem({
      service_id: null,
      product_id: p.id,
      description: p.name,
      quantity: qty,
      list_unit_price: p.base_price,
      discount_amount: 0,
      final_unit_price: p.base_price,
      assigned_staff_id: null,
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5 pb-action lg:grid-cols-3 lg:gap-6 lg:pb-0">
      <div className="space-y-4 lg:col-span-2">
        {/* Cliente */}
        <Card>
          <CardHeader
            title="Cliente"
            subtitle="Buscá un cliente registrado o dejalo como Consumidor Final"
          />

          <CustomerPicker
            revealSelectedContact
            customerId={customerId}
            newClient={newClient}
            selectedCustomer={selectedCustomer}
            firstName={firstName}
            lastName={lastName}
            phone={phone}
            clientSearch={clientSearch}
            clientMatches={clientMatches}
            phoneTaken={phoneTaken}
            renameTo={renameTo}
            useExistingBusy={useExistingClient.isPending}
            searchPlaceholder="Buscar cliente por nombre o WhatsApp…"
            phoneUseHint="Usá esa ficha para esta venta en vez de crear un contacto nuevo."
            searchRef={searchRef}
            phoneRef={phoneRef}
            onSearchChange={setClientSearch}
            onPhoneChange={setPhone}
            onPickExisting={pickExisting}
            onStartNewClient={startNewClient}
            onClear={clearClient}
            onUseExisting={() => useExistingClient.mutate()}
            newClientAfter={
              <button
                type="button"
                onClick={() => setMoreDataOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] py-2 text-xs font-medium text-gold-200 hover:bg-white/10"
              >
                <Pencil className="h-3.5 w-3.5" /> Completar más datos
                (cédula/RUC, email, cumpleaños)
              </button>
            }
            emptyHint={
              <p className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs leading-relaxed text-white/50">
                <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-white/30" />
                <span>
                  Sin cliente: la venta se registra como{' '}
                  <span className="font-medium text-white/80">
                    {CONSUMIDOR_FINAL_LABEL}
                  </span>
                  .
                </span>
              </p>
            }
          />
        </Card>

        {customerId && <CustomerCareCard key={customerId} customerId={customerId} />}

        {/* Detalle de venta (mismo editor que Atención de cita) */}
        <SaleItemsEditor
          items={editorItems}
          staff={staff.data ?? []}
          services={services.data ?? []}
          products={products.data ?? []}
          rules={rules}
          onUpdateItem={(id, patch) =>
            draft.updateItem(id, patch)
          }
          onReassign={(id, staffId) =>
            draft.updateItem(id, { assigned_staff_id: staffId })
          }
          onRemoveItem={(id) => draft.removeItem(id)}
          onAddService={onAddService}
          onAddProduct={onAddProduct}
          assistTypes={(assistTypes.data ?? []).map((t) => t.name)}
          onAddAssist={(id, assist) => draft.addAssist(id, assist)}
          onRemoveAssist={(id, assistId) => draft.removeAssist(id, assistId)}
          onUpdateAssist={(id, assistId, patch) =>
            draft.updateAssist(id, assistId, patch)
          }
          showCommissions={canSeeCommissions}
        />
      </div>

      {/* Resumen */}
      <div className="lg:col-span-1">
        <Card gold className="lg:sticky lg:top-4">
          <CardHeader title="Resumen" />
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={draft.requiresInvoice}
                onChange={(e) => draft.setRequiresInvoice(e.target.checked)}
                className="rounded border-white/20 bg-ink-800 text-gold-400 focus:ring-gold/40"
              />
              Requiere factura
              {draft.requiresInvoice && <Badge tone="gold">Kanban</Badge>}
            </label>

            {/* Totales */}
            <div className="space-y-2 border-t border-white/10 pt-4 text-sm">
              <DetailRow label="Subtotal" value={money(subtotal)} />
              <DetailRow label="Total servicios" value={money(totalServicios)} />
              <DetailRow label="Total productos" value={money(totalProductos)} />
              <DetailRow label="Descuentos" value={`−${money(discountTotal)}`} />
              <div className="flex items-center justify-between border-t border-white/10 pt-2">
                <span className="font-medium text-white/70">Total</span>
                <span className="kpi-gold text-2xl font-semibold">
                  {money(total)}
                </span>
              </div>
            </div>

            {/* Comisiones estilistas */}
            {canSeeCommissions && staffCommissions.length > 0 && (
              <div className="space-y-2 border-t border-white/10 pt-4 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-white/40">
                  Comisiones estilistas
                </p>
                {staffCommissions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-white/70">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: s.color || '#64748b' }}
                      />
                      {s.name}
                    </span>
                    <span className="text-white">{money(s.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-white/10 pt-2">
                  <span className="font-medium text-white/70">
                    Total comisiones
                  </span>
                  <span className="font-semibold text-white">
                    {money(totalCommission)}
                  </span>
                </div>
              </div>
            )}

            <Button
              className="hidden w-full lg:inline-flex"
              size="lg"
              disabled={!canConfirm}
              onClick={() => setConfirmOpen(true)}
            >
              <Check className="h-4 w-4" /> Confirmar venta
            </Button>
          </div>
        </Card>
      </div>

      {/* Cobro siempre visible en móvil */}
      <div className="action-bar lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              Total
            </p>
            <p className="kpi-gold text-xl leading-tight">{money(total)}</p>
          </div>
          <Button
            size="lg"
            disabled={!canConfirm}
            onClick={() => setConfirmOpen(true)}
          >
            <Check className="h-4 w-4" /> Confirmar venta
          </Button>
        </div>
      </div>

      {moreDataOpen && (
        <QuickCustomerModal
          orgId={orgId}
          initial={{
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phone: phone.trim(),
          }}
          onClose={() => setMoreDataOpen(false)}
          onCreated={(c) => {
            setMoreDataOpen(false);
            qc.setQueryData<Customer[]>(['customers', orgId], (old) =>
              old ? [...old, c] : old,
            );
            pickExisting(c);
          }}
        />
      )}

      {confirmOpen && (
        <ConfirmSalePosModal
          orgId={orgId}
          branchId={branchId}
          customerLabel={
            newClient
              ? fullName(firstName, lastName) || CONSUMIDOR_FINAL_LABEL
              : selectedCustomer
                ? customerName(selectedCustomer)
                : CONSUMIDOR_FINAL_LABEL
          }
          customerId={customerId || null}
          newClient={
            newClient
              ? { firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() }
              : null
          }
          items={draft.items}
          requiresInvoice={draft.requiresInvoice}
          subtotal={subtotal}
          discountTotal={discountTotal}
          total={total}
          onClose={() => setConfirmOpen(false)}
          onDone={() => {
            setConfirmOpen(false);
            draft.reset();
            clearClient();
            invalidateSales(qc, branchId);
            invalidateCustomers(qc, orgId);
          }}
        />
      )}
    </div>
  );
}

/**
 * Confirma la venta del POS: crea la venta (con comisiones al colaborador
 * asignado por línea de servicio) y registra el cobro con su forma de pago. El
 * efectivo entra a la caja abierta; transferencia/tarjeta no tocan la caja.
 */
function ConfirmSalePosModal({
  orgId,
  branchId,
  customerLabel,
  customerId,
  newClient,
  items,
  requiresInvoice,
  subtotal,
  discountTotal,
  total,
  onClose,
  onDone,
}: {
  orgId: string;
  branchId: string;
  customerLabel: string;
  customerId: string | null;
  newClient: { firstName: string; lastName: string; phone: string } | null;
  items: DraftSaleItem[];
  requiresInvoice: boolean;
  subtotal: number;
  discountTotal: number;
  total: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const userId = useSession((s) => s.user?.id ?? null);
  const toast = useToast();
  const qc = useQueryClient();
  // Destino del cobro: una cuenta bancaria (transferencia) o "cash" (efectivo).
  const [dest, setDest] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  // Saldo a favor a canjear en esta venta (parcial o total).
  const [creditStr, setCreditStr] = useState('');

  const target = usePaymentTarget(orgId, branchId, dest);
  const { sessionId, effectiveDest, isCash, method, hasOpenCashToday } = target;

  // Saldo a favor disponible del cliente (solo clientes existentes lo tienen).
  const creditQ = useCustomerCredit(customerId);
  const creditAvailable = creditQ.data?.balance ?? 0;
  const creditMethod = storeCreditMethod(target.methods.data);
  const creditUsed = Math.min(Math.max(0, Number(creditStr) || 0), creditAvailable, total);
  const remainderDue = Math.max(0, total - creditUsed);

  const confirm = useMutation({
    mutationFn: async () => {
      // Cliente nuevo al vuelo: se crea antes de la venta (dedup por teléfono).
      let custId = customerId;
      if (newClient) {
        if (!newClient.firstName)
          throw new Error('El nombre del cliente es obligatorio.');
        const phoneError = validatePhone(newClient.phone);
        if (phoneError) throw new Error(phoneError);
        if (newClient.phone) {
          const hit = await findCustomerByPhone(orgId, newClient.phone);
          if (hit)
            throw new Error(
              `Ese número ya es de ${customerName(hit)}. Usá ese contacto en vez de crear uno nuevo.`,
            );
        }
        custId = genId();
        await execute(
          `INSERT INTO customer (id, organization_id, first_name, last_name, phone)
           VALUES (?, ?, ?, ?, ?)`,
          [
            custId,
            orgId,
            newClient.firstName,
            newClient.lastName || null,
            newClient.phone || null,
          ],
        );
      }

      // Comisiones vigentes por colaborador+servicio (config o % por defecto).
      const rules = await loadCommissionRules();
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const draftItems: DraftSaleItem[] = items.map((it) => {
        const commissions: DraftCommission[] = [];
        const assists = it.assists ?? [];
        if (it.service_id && it.assigned_staff_id) {
          const basis = it.final_unit_price * it.quantity;
          const c = commissionForItem(
            it.assigned_staff_id,
            it.service_id,
            basis,
            rules,
          );
          // Las ayudas se descuentan del principal: su comisión queda neta.
          const assistSum = round2(
            assists.reduce((a, x) => a + x.commission_amount, 0),
          );
          commissions.push({
            tempId: genId(),
            staff_member_id: it.assigned_staff_id,
            participation_role: 'primary',
            commission_type: c.commission_type,
            commission_rate: c.commission_rate,
            commission_amount: round2(c.commission_amount - assistSum),
            reduces_primary_amount: false,
          });
          // Una fila `assistant` por ayuda: monto fijo ya restado del principal.
          for (const a of assists) {
            commissions.push({
              tempId: genId(),
              staff_member_id: a.staff_member_id,
              participation_role: 'assistant',
              commission_type: 'fixed',
              commission_rate: a.commission_amount,
              commission_amount: a.commission_amount,
              reduces_primary_amount: true,
              assist_label: a.label,
            });
          }
        }
        return { ...it, commissions };
      });

      const saleId = await createSale({
        orgId,
        branchId,
        userId,
        customerId: custId,
        requiresInvoice,
        items: draftItems,
        subtotal,
        discountTotal,
        total,
      });

      // Canje de saldo a favor: se revalida el disponible contra la base por si
      // cambió en otra pantalla, y se acota a lo que cubre el total.
      let creditToUse = 0;
      if (custId && creditUsed > 0) {
        const avail = await creditBalance(custId);
        creditToUse = Math.min(creditUsed, avail, total);
      }
      const dueInMoney = Math.max(0, total - creditToUse);

      const now = new Date().toISOString();
      const stmts: Stmt[] = [];

      // Parte cobrada en plata real (efectivo/transferencia): el resto del total
      // una vez descontado el saldo a favor.
      if (dueInMoney > 0) {
        if (!method)
          throw new Error(
            `No hay un método de pago ${isCash ? 'en efectivo' : 'por transferencia'} configurado.`,
          );
        const bankId = isCash ? null : effectiveDest;
        const paymentId = genId();
        stmts.push({
          sql: `INSERT INTO payment
                  (id, organization_id, branch_id, sale_id, payment_method_id,
                   bank_account_id, paid_at, amount, status, reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
          args: [
            paymentId,
            orgId,
            branchId,
            saleId,
            method.id,
            bankId,
            now,
            dueInMoney,
            reference || null,
          ],
        });
        // Solo el efectivo ingresa a la caja física.
        if (isCash && sessionId) {
          stmts.push({
            sql: `INSERT INTO cash_movement
                    (id, cash_session_id, branch_id, movement_type, direction, amount,
                     movement_at, sale_id, payment_id, description, created_by)
                  VALUES (?, ?, ?, 'sale', 'in', ?, ?, ?, ?, ?, ?)`,
            args: [
              genId(),
              sessionId,
              branchId,
              dueInMoney,
              now,
              saleId,
              paymentId,
              'Venta POS',
              userId,
            ],
          });
        }
      }

      // Parte pagada con saldo a favor: un pago que NO mueve plata real (sin
      // cuenta ni movimiento de caja) + el descuento del saldo en su libreta.
      if (creditToUse > 0) {
        if (!creditMethod)
          throw new Error('No está configurado el método "Saldo a favor".');
        const creditPaymentId = genId();
        stmts.push({
          sql: `INSERT INTO payment
                  (id, organization_id, branch_id, sale_id, payment_method_id,
                   bank_account_id, paid_at, amount, status, reference)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'confirmed', '[Saldo a favor]')`,
          args: [
            creditPaymentId,
            orgId,
            branchId,
            saleId,
            creditMethod.id,
            now,
            creditToUse,
          ],
        });
        stmts.push({
          sql: `INSERT INTO customer_credit_ledger
                  (id, organization_id, customer_id, amount, kind, sale_id,
                   appointment_id, payment_id, note, created_by, created_at)
                VALUES (?, ?, ?, ?, 'redeem', ?, NULL, ?, '[Canje] venta', ?, ?)`,
          args: [
            genId(),
            orgId,
            custId,
            -creditToUse,
            saleId,
            creditPaymentId,
            userId,
            now,
          ],
        });
      }

      await batch(stmts);
    },
    onSuccess: () => {
      invalidateCredit(qc);
      toast.success(
        'Venta registrada',
        `${customerLabel || 'Consumidor final'} · ${money(total)}`,
      );
      onDone();
    },
    onError: (e) => {
      const msg =
        e instanceof Error ? e.message : 'No se pudo confirmar la venta.';
      setError(msg);
      toast.error('No se pudo confirmar la venta', msg);
    },
  });

  // Si el saldo a favor cubre todo el total, no hace falta mover plata ni tener
  // caja abierta: la venta se cierra solo con el canje.
  const canConfirm =
    !confirm.isPending &&
    total > 0 &&
    (creditUsed === 0 || !!creditMethod) &&
    (remainderDue === 0 || (!!method && hasOpenCashToday));

  return (
    <Modal open onClose={onClose} title="Confirmar venta">
      <div className="space-y-4">
        <div className="space-y-1 rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>Cliente</span>
            <span className="text-white/80">{customerLabel}</span>
          </div>
          <div className="flex justify-between border-t border-white/10 pt-1 font-medium text-white">
            <span>Total a cobrar</span>
            <span className="kpi-gold">{money(total)}</span>
          </div>
        </div>

        {customerId && creditAvailable > 0 && (
          <div className="space-y-2 rounded-xl border border-gold/30 bg-gold/[0.06] p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gold-100">Saldo a favor</span>
              <span className="text-white/60">
                Disponible {money(creditAvailable)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={creditStr}
                onChange={(e) => setCreditStr(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCreditStr(String(Math.min(creditAvailable, total)))
                }
              >
                Usar todo
              </Button>
            </div>
            {creditUsed > 0 && (
              <p className="text-xs text-white/60">
                Canje {money(creditUsed)} · resta {money(remainderDue)} en otro
                medio
              </p>
            )}
          </div>
        )}

        {remainderDue > 0 ? (
          <PaymentTargetFields
            target={target}
            onDest={setDest}
            reference={reference}
            onReference={setReference}
          />
        ) : (
          <p className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
            La venta queda cubierta con el saldo a favor. No entra plata a caja.
          </p>
        )}
        {remainderDue > 0 && !!method && !hasOpenCashToday && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              No podés confirmar la venta con la caja cerrada. Abrí la caja de
              hoy desde el botón <b>Abrir caja</b> de la barra superior.
            </span>
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}

        <Button
          className="w-full"
          disabled={!canConfirm}
          loading={confirm.isPending}
          onClick={() => {
            setError('');
            confirm.mutate();
          }}
        >
          <Check className="h-4 w-4" /> Confirmar venta
        </Button>
      </div>
    </Modal>
  );
}

