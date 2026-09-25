import { useMemo, useState } from 'react';
import { Plus, Trash2, Scissors, Package } from 'lucide-react';
import { money, num, fullName } from '@/lib/format';
import { SERVICE_CATEGORIES } from '@/config/constants';
import { cn } from '@/lib/cn';
import { Button, Card, CardHeader, Input, Select } from '@/components/ui';
import { commissionForItem, type CommissionRule } from './createSale';
import type { CommissionType, Product, Service, StaffMember } from '@/types';

/**
 * Línea de la tabla de detalle de venta. La usan por igual "Atención de cita"
 * (filas de `appointment_item` en DB) y el POS sin cita (líneas del borrador en
 * memoria). El `id` es el identificador de la línea en cada contexto.
 */
export interface EditorItem {
  id: string;
  service_id: string | null;
  product_id: string | null;
  category: string | null;
  description: string;
  quantity: number;
  list_unit_price: number;
  discount_amount: number;
  final_unit_price: number;
  assigned_staff_id: string | null;
  staff_name: string | null;
  staff_color: string | null;
}

export interface LineCommission {
  commission_type: CommissionType;
  commission_rate: number;
  commission_amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Comisión de una línea (solo servicios con estilista y reglas cargadas). */
export function lineCommission(
  i: EditorItem,
  rules: Map<string, CommissionRule> | undefined,
): LineCommission | null {
  if (!i.service_id || !i.assigned_staff_id || !rules) return null;
  return commissionForItem(
    i.assigned_staff_id,
    i.service_id,
    i.final_unit_price * i.quantity,
    rules,
  );
}

/** Comisiones agrupadas por estilista, para el resumen. */
export function commissionByStaff(
  items: EditorItem[],
  rules: Map<string, CommissionRule> | undefined,
): { id: string; name: string; color: string | null; amount: number }[] {
  const m = new Map<
    string,
    { id: string; name: string; color: string | null; amount: number }
  >();
  for (const i of items) {
    const c = lineCommission(i, rules);
    if (!c || !i.assigned_staff_id) continue;
    const prev = m.get(i.assigned_staff_id);
    if (prev) prev.amount += c.commission_amount;
    else
      m.set(i.assigned_staff_id, {
        id: i.assigned_staff_id,
        name: i.staff_name ?? 'Sin nombre',
        color: i.staff_color,
        amount: c.commission_amount,
      });
  }
  return [...m.values()];
}

/**
 * Tabla de detalle de venta + paneles para agregar servicio/producto. Presentacional:
 * recibe las líneas y notifica cambios por callbacks; el contenedor decide si eso
 * escribe en DB (cita) o en el borrador en memoria (POS).
 */
export function SaleItemsEditor({
  items,
  staff,
  services,
  products,
  rules,
  onUpdateItem,
  onReassign,
  onRemoveItem,
  onAddService,
  onAddProduct,
}: {
  items: EditorItem[];
  staff: StaffMember[];
  services: Service[];
  products: Product[];
  rules: Map<string, CommissionRule> | undefined;
  onUpdateItem: (id: string, patch: Record<string, number | string>) => void;
  onReassign: (id: string, staffId: string | null) => void;
  onRemoveItem: (id: string) => void;
  onAddService: (args: { sid: string; stid: string | null }) => void;
  onAddProduct: (args: { pid: string; qty: number }) => void;
}) {
  const [adding, setAdding] = useState<'service' | 'product' | null>(null);
  const [category, setCategory] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');

  const filteredServices = useMemo(
    () => services.filter((s) => !category || s.category === category),
    [services, category],
  );

  const total = items.reduce((a, i) => a + i.final_unit_price * i.quantity, 0);
  const totalCommission = commissionByStaff(items, rules).reduce(
    (a, s) => a + s.amount,
    0,
  );

  const addService = (sid: string, stid: string) => {
    onAddService({ sid, stid: stid || null });
    setServiceId('');
    setStaffId('');
    setAdding(null);
  };
  const addProduct = () => {
    if (!productId) return;
    onAddProduct({ pid: productId, qty: Math.max(1, Math.floor(Number(qty) || 1)) });
    setProductId('');
    setQty('1');
    setAdding(null);
  };

  return (
    <Card>
      <CardHeader
        title="Detalle de venta"
        subtitle="Clic en una celda para editar el precio, descuento o descripción"
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-white/40 [&>th]:pb-2 [&>th]:font-medium">
              <th className="w-1" />
              <th>Descripción</th>
              <th>Estilista responsable</th>
              <th className="text-right">% Estilista</th>
              <th className="text-right">Cant.</th>
              <th className="text-right">P. sugerido</th>
              <th className="text-right">Descuento</th>
              <th className="text-right">P. a cobrar</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-white/40">
                  Sin ítems. Agregá un servicio o producto abajo.
                </td>
              </tr>
            )}
            {items.map((i) => {
              const c = lineCommission(i, rules);
              return (
                <tr key={i.id} className="align-middle">
                  <td className="py-1 pr-1">
                    <span
                      className="block h-8 w-1.5 rounded-full"
                      style={{
                        backgroundColor:
                          i.service_id || i.category
                            ? i.staff_color || '#64748b'
                            : 'transparent',
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <InlineEdit
                      value={i.description}
                      align="left"
                      onCommit={(v) =>
                        v.trim() &&
                        onUpdateItem(i.id, { description: v.trim() })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    {i.service_id || i.category ? (
                      <Select
                        value={i.assigned_staff_id ?? ''}
                        onChange={(e) => onReassign(i.id, e.target.value || null)}
                      >
                        <option value="">Sin asignar</option>
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {fullName(s.first_name, s.last_name)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right text-white/70">
                    {c
                      ? c.commission_type === 'percentage'
                        ? `${num(c.commission_rate)}% · ${money(c.commission_amount)}`
                        : money(c.commission_amount)
                      : '—'}
                  </td>
                  <td className="py-1 text-right">
                    {i.product_id ? (
                      <InlineEdit
                        value={i.quantity}
                        type="number"
                        min={1}
                        onCommit={(v) =>
                          onUpdateItem(i.id, {
                            quantity: Math.max(1, Math.floor(Number(v) || 1)),
                          })
                        }
                      />
                    ) : (
                      <span className="pr-1.5 text-white/50">1</span>
                    )}
                  </td>
                  <td className="py-1 pr-1.5 text-right text-white/50">
                    {money(i.list_unit_price)}
                  </td>
                  <td className="py-1 text-right">
                    <InlineEdit
                      value={i.discount_amount}
                      type="number"
                      display={money(i.discount_amount)}
                      onCommit={(v) => {
                        const disc = Math.max(0, round2(Number(v) || 0));
                        onUpdateItem(i.id, {
                          discount_amount: disc,
                          final_unit_price: round2(i.list_unit_price - disc),
                        });
                      }}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <InlineEdit
                      value={i.final_unit_price}
                      type="number"
                      display={money(i.final_unit_price)}
                      onCommit={(v) => {
                        const fin = round2(Number(v) || 0);
                        onUpdateItem(i.id, {
                          final_unit_price: fin,
                          discount_amount: Math.max(
                            0,
                            round2(i.list_unit_price - fin),
                          ),
                        });
                      }}
                    />
                  </td>
                  <td className="py-1 pl-1 text-right">
                    <button
                      onClick={() => onRemoveItem(i.id)}
                      className="text-white/40 hover:text-danger"
                      title="Eliminar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-white/10 text-sm font-semibold [&>td]:pt-3">
                <td />
                <td className="text-white/50" colSpan={2}>
                  Totales
                </td>
                <td className="whitespace-nowrap text-right text-white/70">
                  {money(totalCommission)}
                </td>
                <td colSpan={3} />
                <td className="kpi-gold text-right">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Agregar ítems */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={adding === 'service' ? 'gold' : 'outline'}
          onClick={() => setAdding(adding === 'service' ? null : 'service')}
        >
          <Scissors className="h-4 w-4" /> Agregar servicio
        </Button>
        <Button
          size="sm"
          variant={adding === 'product' ? 'gold' : 'outline'}
          onClick={() => setAdding(adding === 'product' ? null : 'product')}
        >
          <Package className="h-4 w-4" /> Agregar producto
        </Button>
      </div>

      {adding === 'service' && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-3">
          <Select
            label="Categoría"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setServiceId('');
            }}
          >
            <option value="">Todas</option>
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select
            label="Servicio"
            value={serviceId}
            onChange={(e) => {
              const v = e.target.value;
              if (v && staffId) addService(v, staffId);
              else setServiceId(v);
            }}
          >
            <option value="">Seleccionar…</option>
            {filteredServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {money(s.base_price)}
              </option>
            ))}
          </Select>
          <Select
            label="Estilista"
            value={staffId}
            onChange={(e) => {
              const v = e.target.value;
              if (v && serviceId) addService(serviceId, v);
              else setStaffId(v);
            }}
          >
            <option value="">Sin asignar</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s.first_name, s.last_name)}
              </option>
            ))}
          </Select>
        </div>
      )}

      {adding === 'product' && (
        <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Select
              label="Producto"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {money(p.base_price)}
                </option>
              ))}
            </Select>
          </div>
          <Input
            label="Cant."
            type="number"
            min="1"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <Button className="self-end" onClick={addProduct} disabled={!productId}>
            <Plus className="h-4 w-4" /> Agregar
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Celda con edición en línea: muestra un valor y, al hacer clic, un input. */
export function InlineEdit({
  value,
  display,
  type = 'text',
  align = 'right',
  min,
  onCommit,
}: {
  value: string | number;
  display?: string;
  type?: 'text' | 'number';
  align?: 'left' | 'right';
  min?: number;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        title="Clic para editar"
        className={cn(
          'w-full rounded-md px-1.5 py-1 hover:bg-white/10',
          align === 'right' ? 'text-right' : 'text-left',
        )}
      >
        {display ?? String(value)}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type={type}
      step={type === 'number' ? '0.01' : undefined}
      min={min}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== String(value)) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') setEditing(false);
      }}
      className={cn(
        'w-full rounded-md border border-gold/50 bg-ink-800 px-1.5 py-1 text-white outline-none',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    />
  );
}
