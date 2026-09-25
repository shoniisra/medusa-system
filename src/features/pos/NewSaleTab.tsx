import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Search,
  UserPlus,
  UserRound,
  X,
  AlertTriangle,
} from 'lucide-react';
import { batch, execute, query, queryOne } from '@/lib/db';
import { genId, money, fullName } from '@/lib/format';
import { useSession, useBranchId, useOrgId } from '@/store/session';
import { usePosDraft } from '@/store/posDraft';
import { useCustomers, useServices, useProducts, useStaff } from './useCatalog';
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
import { findCustomerByPhone } from '@/features/clients/customerLookup';
import { qk } from '@/lib/queryClient';
import {
  Button,
  Card,
  CardHeader,
  Input,
  Select,
  Modal,
  Badge,
  PhoneInput,
} from '@/components/ui';
import type {
  CashSession,
  DraftCommission,
  DraftSaleItem,
  PaymentMethod,
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

  const draft = usePosDraft();
  const services = useServices();
  const products = useProducts();
  const customers = useCustomers();
  const staff = useStaff();

  // Cliente (mostrador por defecto): buscar existente o crear al vuelo.
  const [customerId, setCustomerId] = useState('');
  const [newClient, setNewClient] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const selectedCustomer = customers.data?.find((c) => c.id === customerId);
  const hasClient = !!customerId || newClient;

  const clientMatches = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const list = customers.data ?? [];
    if (!q) return [];
    return list
      .filter(
        (c) =>
          fullName(c.first_name, c.last_name).toLowerCase().includes(q) ||
          (c.phone ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [customers.data, clientSearch]);

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
        };
      }),
    [draft.items, staffById],
  );

  const staffCommissions = commissionByStaff(editorItems, rules);
  const totalCommission = staffCommissions.reduce((a, s) => a + s.amount, 0);

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
  const canConfirm = draft.items.length > 0;

  function onAddService({ sid, stid }: { sid: string; stid: string | null }) {
    const s = services.data?.find((x) => x.id === sid);
    if (!s) return;
    draft.addItem({
      service_id: s.id,
      product_id: null,
      description: s.name,
      quantity: 1,
      list_unit_price: s.base_price,
      discount_amount: 0,
      final_unit_price: s.base_price,
      assigned_staff_id: stid,
    });
  }
  function onAddProduct({ pid, qty }: { pid: string; qty: number }) {
    const p = products.data?.find((x) => x.id === pid);
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {/* Cliente */}
        <Card>
          <CardHeader title="Cliente" subtitle="Buscá un cliente o dejá mostrador" />

          {hasClient ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-gold-200">
                  {newClient ? (
                    <UserPlus className="h-4 w-4" />
                  ) : (
                    <UserRound className="h-4 w-4" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-medium text-white">
                    {newClient
                      ? fullName(firstName, lastName) || 'Cliente nuevo'
                      : fullName(
                          selectedCustomer?.first_name ?? '',
                          selectedCustomer?.last_name,
                        )}
                  </p>
                  <p className="text-xs text-white/40">
                    {newClient
                      ? 'Se creará como cliente nuevo'
                      : selectedCustomer?.phone || 'Sin WhatsApp'}
                  </p>
                </div>
              </div>
              <button
                onClick={clearClient}
                className="rounded-lg p-2 text-white/40 hover:bg-white/10 hover:text-white"
                title="Cambiar cliente"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                <input
                  ref={searchRef}
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (clientMatches.length > 0) pickExisting(clientMatches[0]);
                      else if (clientSearch.trim()) startNewClient();
                    }
                  }}
                  placeholder="Buscar cliente por nombre o WhatsApp…"
                  className="input-base w-full pl-9"
                />
              </div>

              {clientSearch.trim() && (
                <ul className="max-h-56 divide-y divide-white/5 overflow-y-auto rounded-xl border border-white/10">
                  {clientMatches.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => pickExisting(c)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/10"
                      >
                        <span className="text-sm text-white/90">
                          {fullName(c.first_name, c.last_name)}
                        </span>
                        {c.phone && (
                          <span className="text-xs text-white/40">{c.phone}</span>
                        )}
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      onClick={startNewClient}
                      className="flex w-full items-center gap-2 px-3 py-3 text-left text-gold-200 hover:bg-white/10"
                    >
                      <UserPlus className="h-4 w-4 shrink-0" />
                      <span className="text-sm">
                        Crear «{clientSearch.trim()}» como cliente nuevo
                      </span>
                    </button>
                  </li>
                </ul>
              )}
            </div>
          )}

          {newClient && (
            <div className="mt-3">
              <PhoneInput
                ref={phoneRef}
                label="WhatsApp"
                value={phone}
                onChange={setPhone}
              />
            </div>
          )}
        </Card>

        {/* Detalle de venta (mismo editor que Atención de cita) */}
        <SaleItemsEditor
          items={editorItems}
          staff={staff.data ?? []}
          services={services.data ?? []}
          products={products.data ?? []}
          rules={rules}
          onUpdateItem={(id, patch) =>
            draft.updateItem(id, patch as Partial<DraftSaleItem>)
          }
          onReassign={(id, staffId) =>
            draft.updateItem(id, { assigned_staff_id: staffId })
          }
          onRemoveItem={(id) => draft.removeItem(id)}
          onAddService={onAddService}
          onAddProduct={onAddProduct}
        />
      </div>

      {/* Resumen */}
      <div className="lg:col-span-1">
        <Card gold className="sticky top-4">
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
              <Row label="Subtotal" value={money(subtotal)} />
              <Row label="Total servicios" value={money(totalServicios)} />
              <Row label="Total productos" value={money(totalProductos)} />
              <Row label="Descuentos" value={`−${money(discountTotal)}`} />
              <div className="flex items-center justify-between border-t border-white/10 pt-2">
                <span className="font-medium text-white/70">Total</span>
                <span className="kpi-gold text-2xl font-semibold">
                  {money(total)}
                </span>
              </div>
            </div>

            {/* Comisiones estilistas */}
            {staffCommissions.length > 0 && (
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
              className="w-full"
              size="lg"
              disabled={!canConfirm}
              onClick={() => setConfirmOpen(true)}
            >
              <Check className="h-4 w-4" /> Confirmar venta
            </Button>
          </div>
        </Card>
      </div>

      {confirmOpen && (
        <ConfirmSalePosModal
          orgId={orgId}
          branchId={branchId}
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
            qc.invalidateQueries({ queryKey: qk.sales(branchId) });
            qc.invalidateQueries({ queryKey: qk.invoiceKanban(branchId) });
            qc.invalidateQueries({ queryKey: ['customers', orgId] });
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
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  const methods = useQuery({
    queryKey: ['payment-methods', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<PaymentMethod>(
        'SELECT * FROM payment_method WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });

  const cash = useQuery({
    queryKey: ['open-cash', branchId],
    enabled: !!branchId,
    queryFn: () =>
      queryOne<CashSession>(
        `SELECT cs.* FROM cash_session cs
           JOIN cash_register cr ON cr.id = cs.cash_register_id
          WHERE cr.branch_id = ? AND cs.status = 'open'
          ORDER BY cs.opened_at DESC LIMIT 1`,
        [branchId],
      ),
  });
  const sessionId = cash.data?.id ?? null;
  const method = methods.data?.find((m) => m.id === methodId);
  const isCash = method?.method_type === 'cash';

  const confirm = useMutation({
    mutationFn: async () => {
      // Cliente nuevo al vuelo: se crea antes de la venta (dedup por teléfono).
      let custId = customerId;
      if (newClient) {
        if (!newClient.firstName)
          throw new Error('El nombre del cliente es obligatorio.');
        if (newClient.phone) {
          const hit = await findCustomerByPhone(orgId, newClient.phone);
          if (hit)
            throw new Error(
              `Ese número ya es de ${fullName(hit.first_name, hit.last_name)}. Buscalo en la lista en vez de crear uno nuevo.`,
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
      const draftItems: DraftSaleItem[] = items.map((it) => {
        const commissions: DraftCommission[] = [];
        if (it.service_id && it.assigned_staff_id) {
          const basis = it.final_unit_price * it.quantity;
          const c = commissionForItem(
            it.assigned_staff_id,
            it.service_id,
            basis,
            rules,
          );
          commissions.push({
            tempId: genId(),
            staff_member_id: it.assigned_staff_id,
            participation_role: 'primary',
            commission_type: c.commission_type,
            commission_rate: c.commission_rate,
            commission_amount: c.commission_amount,
            reduces_primary_amount: false,
          });
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

      const now = new Date().toISOString();
      const stmts: { sql: string; args: (string | number | null)[] }[] = [];
      const paymentId = genId();
      stmts.push({
        sql: `INSERT INTO payment
                (id, organization_id, branch_id, sale_id, payment_method_id, paid_at,
                 amount, status, reference)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
        args: [
          paymentId,
          orgId,
          branchId,
          saleId,
          methodId,
          now,
          total,
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
            total,
            now,
            saleId,
            paymentId,
            'Venta POS',
            userId,
          ],
        });
      }

      await batch(stmts);
    },
    onSuccess: onDone,
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'No se pudo confirmar la venta.'),
  });

  const canConfirm = !confirm.isPending && !!methodId && total > 0;

  return (
    <Modal open onClose={onClose} title="Confirmar venta">
      <div className="space-y-4">
        <div className="space-y-1 rounded-xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between border-t border-white/10 pt-1 font-medium text-white">
            <span>Total a cobrar</span>
            <span className="kpi-gold">{money(total)}</span>
          </div>
        </div>

        <Select
          label="Forma de pago"
          value={methodId}
          onChange={(e) => setMethodId(e.target.value)}
        >
          <option value="">Seleccionar…</option>
          {methods.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>

        <Input
          label="Referencia (opcional)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Nº transferencia, voucher…"
        />

        {isCash && !sessionId && (
          <p className="flex items-center gap-1.5 text-xs text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5" /> No hay caja abierta: el pago
            se registra pero no entra al efectivo de caja.
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/50">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
