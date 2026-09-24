import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ShoppingBag, Check } from 'lucide-react';
import { usePosDraft } from '@/store/posDraft';
import { useSession, useBranchId, useOrgId } from '@/store/session';
import { useCustomers, useServices, useProducts } from './useCatalog';
import { CommissionEditor } from './CommissionEditor';
import { createSale } from './createSale';
import { qk } from '@/lib/queryClient';
import { money, fullName } from '@/lib/format';
import {
  Button,
  Card,
  CardHeader,
  Input,
  Select,
  EmptyState,
  Badge,
} from '@/components/ui';

export function NewSaleTab() {
  const orgId = useOrgId();
  const branchId = useBranchId();
  const userId = useSession((s) => s.user?.id ?? null);
  const qc = useQueryClient();

  const draft = usePosDraft();
  const services = useServices();
  const products = useProducts();
  const customers = useCustomers();

  const [kind, setKind] = useState<'service' | 'product'>('service');
  const [refId, setRefId] = useState('');
  const [qty, setQty] = useState('1');
  const [discount, setDiscount] = useState('0');

  function addItem() {
    const q = Number(qty) || 1;
    const disc = Number(discount) || 0;
    if (kind === 'service') {
      const s = services.data?.find((x) => x.id === refId);
      if (!s) return;
      draft.addItem({
        service_id: s.id,
        product_id: null,
        description: s.name,
        quantity: q,
        list_unit_price: s.base_price,
        discount_amount: disc,
        final_unit_price: Math.max(0, s.base_price - disc),
      });
    } else {
      const p = products.data?.find((x) => x.id === refId);
      if (!p) return;
      draft.addItem({
        service_id: null,
        product_id: p.id,
        description: p.name,
        quantity: q,
        list_unit_price: p.base_price,
        discount_amount: disc,
        final_unit_price: Math.max(0, p.base_price - disc),
      });
    }
    setRefId('');
    setQty('1');
    setDiscount('0');
  }

  const confirm = useMutation({
    mutationFn: () =>
      createSale({
        orgId,
        branchId,
        userId,
        customerId: draft.customerId,
        requiresInvoice: draft.requiresInvoice,
        items: draft.items,
        subtotal: draft.subtotal(),
        discountTotal: draft.discountTotal(),
        total: draft.total(),
      }),
    onSuccess: () => {
      draft.reset();
      qc.invalidateQueries({ queryKey: qk.sales(branchId) });
      qc.invalidateQueries({ queryKey: qk.invoiceKanban(branchId) });
    },
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Constructor de items */}
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="Agregar ítem" subtitle="Servicio o producto" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Select
              label="Tipo"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as 'service' | 'product');
                setRefId('');
              }}
            >
              <option value="service">Servicio</option>
              <option value="product">Producto</option>
            </Select>
            <div className="col-span-2">
              <Select
                label={kind === 'service' ? 'Servicio' : 'Producto'}
                value={refId}
                onChange={(e) => setRefId(e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {(kind === 'service' ? services.data : products.data)?.map(
                  (x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {money(x.base_price)}
                    </option>
                  ),
                )}
              </Select>
            </div>
            <Input
              label="Cant."
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <Input
              label="Desc. $"
              type="number"
              min="0"
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <Button className="mt-4" onClick={addItem} disabled={!refId}>
            <Plus className="h-4 w-4" /> Agregar
          </Button>
        </Card>

        {/* Lista de items con distribución de comisiones */}
        {draft.items.length === 0 ? (
          <Card>
            <EmptyState
              icon={ShoppingBag}
              title="Venta vacía"
              description="Agregá servicios o productos para empezar."
            />
          </Card>
        ) : (
          draft.items.map((item) => (
            <Card key={item.tempId}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-white">{item.description}</p>
                  <p className="text-xs text-white/40">
                    {item.quantity} × {money(item.final_unit_price)}
                    {item.discount_amount > 0 &&
                      ` · desc. ${money(item.discount_amount)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="kpi-gold text-lg">
                    {money(item.final_unit_price * item.quantity)}
                  </span>
                  <button
                    onClick={() => draft.removeItem(item.tempId)}
                    className="text-white/40 hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Comisiones solo aplican a servicios */}
              {item.service_id && <CommissionEditor item={item} />}
            </Card>
          ))
        )}
      </div>

      {/* Resumen y confirmación */}
      <div className="lg:col-span-1">
        <Card gold className="sticky top-4">
          <CardHeader title="Resumen" />
          <div className="space-y-4">
            <Select
              label="Cliente"
              value={draft.customerId ?? ''}
              onChange={(e) => draft.setCustomer(e.target.value || null)}
            >
              <option value="">Sin cliente (mostrador)</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c.first_name, c.last_name)}
                </option>
              ))}
            </Select>

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

            <div className="space-y-2 border-t border-white/10 pt-4 text-sm">
              <Row label="Subtotal" value={money(draft.subtotal())} />
              <Row label="Descuentos" value={`−${money(draft.discountTotal())}`} />
              <div className="flex items-center justify-between border-t border-white/10 pt-2">
                <span className="font-medium text-white/70">Total</span>
                <span className="kpi-gold text-2xl">{money(draft.total())}</span>
              </div>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={draft.items.length === 0}
              loading={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              <Check className="h-4 w-4" /> Confirmar venta
            </Button>
            {confirm.isSuccess && (
              <p className="text-center text-xs text-success">
                Venta registrada. Cobrá el saldo en “Cobros”.
              </p>
            )}
            {confirm.isError && (
              <p className="text-center text-xs text-danger">
                {confirm.error instanceof Error
                  ? confirm.error.message
                  : 'Error al guardar'}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
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
