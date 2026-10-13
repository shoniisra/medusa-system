import { Fragment, useMemo, useState } from 'react';
import {
  Plus,
  Minus,
  Trash2,
  Scissors,
  Package,
  Search,
  ChevronLeft,
  AlertTriangle,
  HandHelping,
} from 'lucide-react';
import { money, num, fullName } from '@/lib/format';
import { SERVICE_CATEGORIES } from '@/config/constants';
import { cn } from '@/lib/cn';
import { Button, Card, CardHeader, Input, Modal, Select } from '@/components/ui';
import { commissionForItem, type CommissionRule } from './createSale';
import { useCategorySkills } from '@/features/staff/useCategorySkills';
import {
  useCreateProduct,
  useCreateService,
  type NewProductDraft,
  type NewServiceDraft,
} from './useCatalog';
import type {
  CommissionType,
  LineAssist,
  Product,
  Service,
  StaffMember,
} from '@/types';
import { normalizeText } from '@/lib/text';

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
  /** Ayudas de otras colaboradoras en esta línea (restan del principal). */
  assists?: LineAssist[];
}

export interface LineCommission {
  commission_type: CommissionType;
  commission_rate: number;
  commission_amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cambiar el precio a cobrar recalcula el descuento contra el precio de lista:
 * el descuento no se edita a mano, se deduce. Lo usan la vista de tarjetas y la
 * de tabla, que lo tenían duplicado.
 */
function finalPricePatch(
  i: EditorItem,
  value: string,
): Record<string, number> {
  const fin = round2(Number(value) || 0);
  return {
    final_unit_price: fin,
    discount_amount: Math.max(0, round2(i.list_unit_price - fin)),
  };
}

/**
 * Convierte una fila reservada por categoría (sin servicio concreto) en un
 * servicio vendible: le fija `service_id`, nombre y precio de lista. Si ya tenía
 * un precio cargado a mano se respeta y se recalcula el descuento; si no, toma
 * el precio del servicio. Sin esto, la cita reservada por categoría nunca se
 * puede cobrar: el ítem no tiene servicio ni producto y queda fuera de la venta.
 */
function servicePatch(
  i: EditorItem,
  s: Service,
): Record<string, number | string> {
  const list = round2(s.base_price);
  const keep = i.final_unit_price > 0 ? round2(i.final_unit_price) : list;
  return {
    service_id: s.id,
    description: s.name,
    list_unit_price: list,
    final_unit_price: keep,
    discount_amount: Math.max(0, round2(list - keep)),
  };
}

/** Comisión de una línea (solo servicios con estilista y reglas cargadas). */
function lineCommission(
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

/** Suma de las ayudas de una línea (lo que se reparte fuera del principal). */
export function lineAssistsTotal(i: EditorItem): number {
  return round2((i.assists ?? []).reduce((a, x) => a + x.commission_amount, 0));
}

/**
 * Comisión del principal YA NETA de las ayudas: lo que cobra la estilista
 * responsable después de repartir a las ayudantes de la línea.
 */
export function linePrimaryNet(
  i: EditorItem,
  rules: Map<string, CommissionRule> | undefined,
): number | null {
  const c = lineCommission(i, rules);
  if (!c) return null;
  return round2(c.commission_amount - lineAssistsTotal(i));
}

/**
 * Comisiones agrupadas por colaborador para el resumen: el principal con su
 * monto YA NETO de ayudas, y cada ayudante con lo suyo. La suma total de la
 * línea no cambia (solo se reparte), así los totales de abajo cuadran.
 */
export function commissionByStaff(
  items: EditorItem[],
  rules: Map<string, CommissionRule> | undefined,
): { id: string; name: string; color: string | null; amount: number }[] {
  const m = new Map<
    string,
    { id: string; name: string; color: string | null; amount: number }
  >();
  const add = (
    id: string,
    name: string,
    color: string | null,
    amount: number,
  ) => {
    const prev = m.get(id);
    if (prev) prev.amount = round2(prev.amount + amount);
    else m.set(id, { id, name, color, amount: round2(amount) });
  };
  for (const i of items) {
    const c = lineCommission(i, rules);
    if (c && i.assigned_staff_id) {
      add(
        i.assigned_staff_id,
        i.staff_name ?? 'Sin nombre',
        i.staff_color,
        c.commission_amount - lineAssistsTotal(i),
      );
    }
    for (const a of i.assists ?? []) {
      add(a.staff_member_id, a.staff_name ?? 'Sin nombre', a.staff_color, a.commission_amount);
    }
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
  assistTypes = [],
  onAddAssist,
  onRemoveAssist,
  onUpdateAssist,
}: {
  items: EditorItem[];
  staff: StaffMember[];
  services: Service[];
  products: Product[];
  rules: Map<string, CommissionRule> | undefined;
  onUpdateItem: (id: string, patch: Record<string, number | string>) => void;
  onReassign: (id: string, staffId: string | null) => void;
  onRemoveItem: (id: string) => void;
  /** Catálogo de tipos de ayuda (nombres) para el selector. */
  assistTypes?: string[];
  /** Registrar una ayuda en una línea. Si falta, no se muestra la UI de ayudas. */
  onAddAssist?: (itemId: string, assist: Omit<LineAssist, 'id'>) => void;
  onRemoveAssist?: (itemId: string, assistId: string) => void;
  onUpdateAssist?: (
    itemId: string,
    assistId: string,
    patch: { label?: string; commission_amount?: number },
  ) => void;
  /** `service` viene solo en el alta al vuelo: aún no está en el catálogo cargado. */
  onAddService: (args: {
    sid: string;
    stid: string | null;
    service?: Service;
  }) => void;
  /** `product` viene solo en el alta al vuelo: aún no está en el catálogo cargado. */
  onAddProduct: (args: {
    pid: string;
    qty: number;
    product?: Product;
  }) => void;
}) {
  const [adding, setAdding] = useState<'service' | 'product' | null>(null);

  const total = items.reduce((a, i) => a + i.final_unit_price * i.quantity, 0);
  const totalCommission = commissionByStaff(items, rules).reduce(
    (a, s) => a + s.amount,
    0,
  );

  return (
    <Card>
      <CardHeader
        title="Detalle de venta"
        subtitle="Tocá un valor para editarlo: precio, descuento o descripción"
      />
      {/* Móvil: una tarjeta por línea (la tabla no entra en un teléfono) */}
      <div className="space-y-2.5 lg:hidden">
        {items.length === 0 && (
          <p className="rounded-2xl border border-dashed border-white/10 py-8 text-center text-sm text-white/40">
            Sin ítems. Agregá un servicio o producto abajo.
          </p>
        )}
        {items.map((i) => {
          const c = lineCommission(i, rules);
          const assignable = !!(i.service_id || i.category);
          const placeholder = !i.service_id && !i.product_id;
          const assistSum = lineAssistsTotal(i);
          const net = c ? round2(c.commission_amount - assistSum) : 0;
          return (
            <div
              key={i.id}
              className={cn(
                'rounded-2xl border p-3',
                placeholder
                  ? 'border-amber-400/60 bg-amber-400/[0.08] ring-1 ring-amber-400/30'
                  : 'border-white/10 bg-white/[0.03]',
              )}
              style={
                placeholder
                  ? undefined
                  : {
                      borderLeft: `3px solid ${
                        assignable ? i.staff_color || '#64748b' : 'transparent'
                      }`,
                    }
              }
            >
              <div className="flex items-start gap-2">
                {placeholder ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
                    <span className="text-[13px] font-semibold text-amber-200">
                      Falta elegir el servicio
                      {i.category ? ` de ${i.category}` : ''}
                    </span>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1 text-[15px] font-medium text-white">
                    <InlineEdit
                      value={i.description}
                      align="left"
                      onCommit={(v) =>
                        v.trim() && onUpdateItem(i.id, { description: v.trim() })
                      }
                    />
                  </div>
                )}
                <button
                  onClick={() => onRemoveItem(i.id)}
                  aria-label="Eliminar ítem"
                  className="tap -mr-1 flex shrink-0 items-center justify-center rounded-lg text-white/40 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {placeholder && (
                <div className="mt-2 space-y-1.5">
                  <ServicePicker
                    item={i}
                    services={services}
                    onPick={(patch) => onUpdateItem(i.id, patch)}
                  />
                  <p className="text-[11px] text-amber-200/70">
                    Reservado por categoría. Sin un servicio concreto no se puede
                    cobrar.
                  </p>
                </div>
              )}

              {assignable && (
                <div className="mt-2">
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
                </div>
              )}

              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-xl bg-white/[0.04] px-2 py-1.5">
                  <span className="block text-[10px] uppercase tracking-wide text-white/40">
                    Cant.
                  </span>
                  {i.product_id ? (
                    <QtyStepper
                      value={i.quantity}
                      onChange={(q) => onUpdateItem(i.id, { quantity: q })}
                    />
                  ) : (
                    <span className="text-white/70">1</span>
                  )}
                </div>
                <div className="rounded-xl bg-white/[0.04] px-2 py-1.5">
                  <span className="block text-[10px] uppercase tracking-wide text-white/40">
                    Descuento
                  </span>
                  <InlineEdit
                    value={i.discount_amount}
                    type="number"
                    align="left"
                    display={money(i.discount_amount)}
                    onCommit={(v) => {
                      const disc = Math.max(0, round2(Number(v) || 0));
                      onUpdateItem(i.id, {
                        discount_amount: disc,
                        final_unit_price: round2(i.list_unit_price - disc),
                      });
                    }}
                  />
                </div>
                <div className="rounded-xl bg-gold/10 px-2 py-1.5">
                  <span className="block text-[10px] uppercase tracking-wide text-gold-200/60">
                    A cobrar
                  </span>
                  <span className="block font-semibold text-gold-100">
                    <InlineEdit
                      value={i.final_unit_price}
                      type="number"
                      align="left"
                      display={money(i.final_unit_price)}
                      onCommit={(v) => onUpdateItem(i.id, finalPricePatch(i, v))}
                    />
                  </span>
                </div>
              </div>

              {c && (
                <p className="mt-2 text-xs text-white/40">
                  Comisión estilista:{' '}
                  <span className="text-white/70">
                    {assistSum > 0
                      ? money(net)
                      : c.commission_type === 'percentage'
                        ? `${num(c.commission_rate)}% · ${money(c.commission_amount)}`
                        : money(c.commission_amount)}
                  </span>
                  {assistSum > 0 && (
                    <span className="text-white/35">
                      {' '}
                      · −{money(assistSum)} en ayudas
                    </span>
                  )}
                </p>
              )}

              {assignable && onAddAssist && (
                <AssistsBlock
                  item={i}
                  staff={staff}
                  assistTypes={assistTypes}
                  onAddAssist={onAddAssist}
                  onRemoveAssist={onRemoveAssist}
                  onUpdateAssist={onUpdateAssist}
                />
              )}
            </div>
          );
        })}

        {items.length > 0 && (
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
            <span className="text-sm font-medium text-white/60">Total</span>
            <span className="kpi-gold text-lg">{money(total)}</span>
          </div>
        )}
      </div>

      {/* Escritorio: tabla completa con todas las columnas */}
      <div className="hidden overflow-x-auto lg:block">
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
              const placeholder = !i.service_id && !i.product_id;
              const assignable = !!(i.service_id || i.category);
              const assistSum = lineAssistsTotal(i);
              const net = c ? round2(c.commission_amount - assistSum) : 0;
              return (
                <Fragment key={i.id}>
                <tr
                  className={cn('align-middle', placeholder && 'bg-amber-400/[0.07]')}
                >
                  <td className="py-1 pr-1">
                    <span
                      className="block h-8 w-1.5 rounded-full"
                      style={{
                        backgroundColor: placeholder
                          ? '#f59e0b'
                          : i.service_id || i.category
                            ? i.staff_color || '#64748b'
                            : 'transparent',
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    {placeholder ? (
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
                        <div className="min-w-0 flex-1">
                          <ServicePicker
                            item={i}
                            services={services}
                            onPick={(patch) => onUpdateItem(i.id, patch)}
                          />
                        </div>
                      </div>
                    ) : (
                      <InlineEdit
                        value={i.description}
                        align="left"
                        onCommit={(v) =>
                          v.trim() &&
                          onUpdateItem(i.id, { description: v.trim() })
                        }
                      />
                    )}
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
                    {!c ? (
                      '—'
                    ) : assistSum > 0 ? (
                      <>
                        {money(net)}
                        <span className="block text-[10px] text-white/35">
                          −{money(assistSum)} ayudas
                        </span>
                      </>
                    ) : c.commission_type === 'percentage' ? (
                      `${num(c.commission_rate)}% · ${money(c.commission_amount)}`
                    ) : (
                      money(c.commission_amount)
                    )}
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
                      onCommit={(v) => onUpdateItem(i.id, finalPricePatch(i, v))}
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
                {assignable && onAddAssist && (
                  <tr className={cn(placeholder && 'bg-amber-400/[0.07]')}>
                    <td />
                    <td colSpan={8} className="pb-2 pr-2">
                      <AssistsBlock
                        item={i}
                        staff={staff}
                        assistTypes={assistTypes}
                        onAddAssist={onAddAssist}
                        onRemoveAssist={onRemoveAssist}
                        onUpdateAssist={onUpdateAssist}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
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

      {/* Agregar ítems: se eligen en una hoja inferior, con tarjetas */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button
          variant="outline"
          onClick={() => setAdding('service')}
          className="sm:h-9 sm:px-3.5"
        >
          <Scissors className="h-4 w-4" /> Servicio
        </Button>
        <Button
          variant="outline"
          onClick={() => setAdding('product')}
          className="sm:h-9 sm:px-3.5"
        >
          <Package className="h-4 w-4" /> Producto
        </Button>
      </div>

      {adding === 'service' && (
        <AddServiceSheet
          open
          onClose={() => setAdding(null)}
          services={services}
          staff={staff}
          onAdd={(sid, stid, service) => {
            onAddService({ sid, stid, service });
            setAdding(null);
          }}
        />
      )}
      {adding === 'product' && (
        <AddProductSheet
          open
          onClose={() => setAdding(null)}
          products={products}
          onAdd={(pid, qty, product) => {
            onAddProduct({ pid, qty, product });
            setAdding(null);
          }}
        />
      )}
    </Card>
  );
}

/** Valor centinela para "otra ayuda" (texto libre) en el selector. */
const CUSTOM_ASSIST = '__custom__';

/**
 * Ayudas de una línea: otras colaboradoras que asistieron un paso del servicio
 * (lavar, sujetar, secar...). Cada una lleva un monto editable que se resta de
 * la comisión de la estilista responsable. Solo se registran si la línea ya
 * tiene estilista (hay de quién descontar).
 */
function AssistsBlock({
  item,
  staff,
  assistTypes,
  onAddAssist,
  onRemoveAssist,
  onUpdateAssist,
}: {
  item: EditorItem;
  staff: StaffMember[];
  assistTypes: string[];
  onAddAssist: (itemId: string, assist: Omit<LineAssist, 'id'>) => void;
  onRemoveAssist?: (itemId: string, assistId: string) => void;
  onUpdateAssist?: (
    itemId: string,
    assistId: string,
    patch: { label?: string; commission_amount?: number },
  ) => void;
}) {
  const [adding, setAdding] = useState(false);
  const assists = item.assists ?? [];
  const canAssist = !!item.assigned_staff_id;

  if (!canAssist && assists.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-white/35">
        Asigná la estilista responsable para registrar ayudas.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      {assists.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1 text-xs"
        >
          <HandHelping className="h-3.5 w-3.5 shrink-0 text-gold-300" />
          <span className="truncate text-white/80">{a.label}</span>
          <span className="inline-flex items-center gap-1 text-white/50">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: a.staff_color || '#64748b' }}
            />
            {a.staff_name ?? 'Sin nombre'}
          </span>
          <span className="ml-auto whitespace-nowrap font-medium text-white/80">
            {onUpdateAssist ? (
              <InlineEdit
                value={a.commission_amount}
                type="number"
                align="left"
                display={money(a.commission_amount)}
                onCommit={(v) =>
                  onUpdateAssist(item.id, a.id, {
                    commission_amount: Math.max(0, round2(Number(v) || 0)),
                  })
                }
              />
            ) : (
              money(a.commission_amount)
            )}
          </span>
          {onRemoveAssist && (
            <button
              type="button"
              onClick={() => onRemoveAssist(item.id, a.id)}
              className="shrink-0 text-white/40 hover:text-danger"
              title="Quitar ayuda"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {canAssist && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-white/15 px-2 py-1 text-xs font-medium text-white/55 hover:border-gold/40 hover:text-gold-200"
        >
          <HandHelping className="h-3.5 w-3.5" /> Ayuda
        </button>
      )}

      {adding && (
        <AddAssistSheet
          open
          staff={staff}
          assistTypes={assistTypes}
          excludeStaffId={item.assigned_staff_id}
          onClose={() => setAdding(false)}
          onAdd={(assist) => {
            onAddAssist(item.id, assist);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

/** Alta de una ayuda: quién ayudó, qué ayuda fue y cuánto se le reparte. */
function AddAssistSheet({
  open,
  onClose,
  staff,
  assistTypes,
  excludeStaffId,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  staff: StaffMember[];
  assistTypes: string[];
  excludeStaffId: string | null;
  onAdd: (assist: Omit<LineAssist, 'id'>) => void;
}) {
  const [staffId, setStaffId] = useState('');
  const [label, setLabel] = useState('');
  const [custom, setCustom] = useState('');
  const [amount, setAmount] = useState('');

  const useCustom = label === CUSTOM_ASSIST;
  const chosenLabel = (useCustom ? custom : label).trim();
  const amountNum = Math.max(0, round2(Number(amount) || 0));
  const options = staff.filter((s) => s.id !== excludeStaffId);
  const ready = !!staffId && !!chosenLabel && amountNum > 0;

  const submit = () => {
    const s = staff.find((x) => x.id === staffId);
    if (!s || !chosenLabel || amountNum <= 0) return;
    onAdd({
      staff_member_id: s.id,
      staff_name: fullName(s.first_name, s.last_name),
      staff_color: s.color ?? null,
      label: chosenLabel,
      commission_amount: amountNum,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Agregar ayuda" className="sm:max-w-lg">
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">
            ¿Quién ayudó?
          </p>
          {options.length === 0 ? (
            <p className="text-xs text-white/40">
              No hay otras colaboradoras para asignar.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {options.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStaffId(s.id)}
                  className={cn(
                    CARD_BASE,
                    staffId === s.id && 'border-gold-400/70 bg-gold-400/10',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: s.color || '#64748b' }}
                  />
                  {fullName(s.first_name, s.last_name)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">
            ¿Qué ayuda?
          </p>
          <div className="flex flex-wrap gap-2">
            {assistTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setLabel(t)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm',
                  label === t
                    ? 'border-gold-400/70 bg-gold-400/10 text-gold-100'
                    : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]',
                )}
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setLabel(CUSTOM_ASSIST)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm',
                useCustom
                  ? 'border-gold-400/70 bg-gold-400/10 text-gold-100'
                  : 'border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]',
              )}
            >
              Otra…
            </button>
          </div>
          {useCustom && (
            <Input
              className="mt-2"
              autoFocus
              placeholder="Describí la ayuda"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">
            Comisión de la ayuda
          </p>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-white/35">
            Se resta de la comisión de la estilista responsable.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!ready} onClick={submit}>
            Agregar ayuda
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Selector de servicio para una fila reservada por categoría. Al elegir, la
 * línea pasa de "intención de reserva" a servicio vendible (ver `servicePatch`),
 * que es lo que habilita el botón de cobrar. Prioriza los servicios de la misma
 * categoría de la reserva y deja el resto en un grupo aparte.
 */
function ServicePicker({
  item,
  services,
  onPick,
}: {
  item: EditorItem;
  services: Service[];
  onPick: (patch: Record<string, number | string>) => void;
}) {
  const cat = item.category ?? '';
  // Los de la misma categoría primero; al resto se les muestra su categoría
  // para no confundir. (El Select solo lee <option> directos: nada de optgroup.)
  const sorted = [...services].sort((a, b) => {
    const am = (a.category ?? '') === cat ? 0 : 1;
    const bm = (b.category ?? '') === cat ? 0 : 1;
    return am - bm || a.name.localeCompare(b.name);
  });
  const pick = (id: string) => {
    const s = services.find((x) => x.id === id);
    if (s) onPick(servicePatch(item, s));
  };
  return (
    <Select
      value=""
      onChange={(e) => e.target.value && pick(e.target.value)}
      className="border-amber-400/70 bg-amber-400/10 font-medium text-amber-100"
    >
      <option value="">
        {item.category ? `Elegí el servicio de ${item.category}…` : 'Elegí el servicio…'}
      </option>
      {sorted.map((s) => (
        <option key={s.id} value={s.id}>
          {(s.category ?? '') === cat
            ? `${s.name} · ${money(s.base_price)}`
            : `${s.name} · ${money(s.base_price)} (${s.category ?? 'Otros'})`}
        </option>
      ))}
    </Select>
  );
}

/** Celda con edición en línea: muestra un valor y, al hacer clic, un input. */
function InlineEdit({
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

/** Cantidad con −/+ : en un teléfono es más rápido y seguro que tipear. */
function QtyStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (q: number) => void;
}) {
  const set = (q: number) => onChange(Math.max(1, Math.floor(q)));
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => set(value - 1)}
        aria-label="Quitar uno"
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 active:scale-95"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-[1.25rem] text-center font-medium text-white">
        {value}
      </span>
      <button
        type="button"
        onClick={() => set(value + 1)}
        aria-label="Agregar uno"
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 active:scale-95"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/* ───────────────── Hojas para agregar ítems (tarjetas) ───────────────── */

const CARD_BASE =
  'flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center text-sm font-medium text-white/85 transition active:scale-[0.97] hover:bg-white/[0.06]';

/** Buscador de la hoja. Sin autofoco: en móvil taparía las tarjetas. */
function SheetSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative mb-3">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-base pl-9"
      />
    </div>
  );
}

/**
 * Agregar servicio en pasos: categoría → servicio → estilista. Cada paso son
 * tarjetas grandes (mismo gesto que elegir categorías al agendar); el buscador
 * saltea los pasos cuando ya se sabe el nombre.
 */
function AddServiceSheet({
  open,
  onClose,
  services,
  staff,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  services: Service[];
  staff: StaffMember[];
  /** `service` viene solo en el alta al vuelo: aún no está en el catálogo cargado. */
  onAdd: (sid: string, stid: string | null, service?: Service) => void;
}) {
  const [category, setCategory] = useState('');
  const [service, setService] = useState<Service | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  // Fila recién creada: se arrastra hasta el paso de estilista porque el
  // contenedor todavía tiene en memoria el catálogo anterior.
  const [created, setCreated] = useState<Service | null>(null);
  const createService = useCreateService();
  const { eligibleByCat, defaultStaffForCategory } = useCategorySkills();

  // Para el paso "¿Quién lo hace?": estilista sugerida por especialidad y
  // orden que pone a las candidatas de la categoría primero.
  const staffPick = useMemo(() => {
    if (!service) {
      return { ordered: staff, suggestedId: '', priorityById: new Map<string, number>() };
    }
    const elig = eligibleByCat.get(service.category ?? '') ?? [];
    const priorityById = new Map(elig.map((e) => [e.staffId, e.priority]));
    const suggestedId = defaultStaffForCategory(service.category);
    const ordered = [
      ...elig
        .map((e) => staff.find((s) => s.id === e.staffId))
        .filter((s): s is StaffMember => !!s),
      ...staff.filter((s) => !priorityById.has(s.id)),
    ];
    return { ordered, suggestedId, priorityById };
  }, [service, staff, eligibleByCat, defaultStaffForCategory]);

  const OTHERS = 'Otros';
  // Solo las categorías que tienen servicios cargados.
  const categories = useMemo(() => {
    const used = new Set(services.map((s) => s.category || OTHERS));
    const known = SERVICE_CATEGORIES.filter((c) => used.has(c));
    return used.has(OTHERS) ? [...known, OTHERS] : known;
  }, [services]);

  const countByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of services) {
      const k = s.category || OTHERS;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [services]);

  const list = useMemo(() => {
    const term = normalizeText(q);
    if (term) return services.filter((s) => normalizeText(s.name).includes(term));
    if (category) {
      return services.filter((s) => (s.category || OTHERS) === category);
    }
    return [];
  }, [services, q, category]);

  const searching = q.trim().length > 0;
  const step: 'category' | 'service' | 'staff' = service
    ? 'staff'
    : searching || category
      ? 'service'
      : 'category';

  const title = creating
    ? 'Nuevo servicio'
    : step === 'staff'
      ? '¿Quién lo hace?'
      : step === 'service'
        ? category || 'Buscar servicio'
        : 'Agregar servicio';

  return (
    <Modal open={open} onClose={onClose} title={title} className="sm:max-w-2xl">
      {creating ? (
        <NewServiceForm
          initialName={q.trim()}
          initialCategory={category}
          saving={createService.isPending}
          error={
            createService.isError
              ? 'No se pudo guardar el servicio. Reintentá.'
              : ''
          }
          onCancel={() => setCreating(false)}
          onSubmit={(draft) => {
            void createService
              .mutateAsync(draft)
              .then((s) => {
                // Se pasa al paso de estilista y se recuerda la fila para el alta.
                setCreated(s);
                setService(s);
                setCreating(false);
              })
              .catch(() => {
                /* el aviso ya lo da createService.isError en el formulario */
              });
          }}
        />
      ) : (
        <>
          {step !== 'category' && (
            <button
              type="button"
              onClick={() => (service ? setService(null) : (setCategory(''), setQ('')))}
              className="mb-3 flex items-center gap-1 text-sm text-white/50 active:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
              {service ? 'Cambiar servicio' : 'Todas las categorías'}
            </button>
          )}

          {step === 'staff' && service ? (
        <>
          <p className="mb-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/70">
            <span className="font-medium text-white">{service.name}</span>
            {' · '}
            <span className="text-gold-200">{money(service.base_price)}</span>
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <button
              type="button"
              onClick={() =>
                onAdd(
                  service.id,
                  null,
                  created?.id === service.id ? created : undefined,
                )
              }
              className={cn(CARD_BASE, 'text-white/60')}
            >
              Sin asignar
            </button>
            {staffPick.ordered.map((s) => {
              const suggested = s.id === staffPick.suggestedId;
              const backup = (staffPick.priorityById.get(s.id) ?? 1) >= 2;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    onAdd(
                      service.id,
                      s.id,
                      created?.id === service.id ? created : undefined,
                    )
                  }
                  className={cn(
                    CARD_BASE,
                    suggested && 'border-gold-400/70 bg-gold-400/10',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: s.color || '#64748b' }}
                  />
                  {fullName(s.first_name, s.last_name)}
                  {suggested ? (
                    <span className="text-[11px] font-medium text-gold-200">
                      sugerida
                    </span>
                  ) : backup ? (
                    <span className="text-[11px] text-white/40">respaldo</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <SheetSearch value={q} onChange={setQ} placeholder="Buscar servicio…" />
          {step === 'category' ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {/* Alta rápida: el catálogo se arma sobre la marcha, sin salir de
                  la venta. */}
              <button
                type="button"
                onClick={() => setCreating(true)}
                className={cn(
                  CARD_BASE,
                  'border-dashed border-gold/40 bg-gold/[0.06] text-gold-100',
                )}
              >
                <Plus className="h-5 w-5" />
                Nuevo servicio
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={CARD_BASE}
                >
                  {c}
                  <span className="text-[11px] font-normal text-white/40">
                    {countByCategory.get(c)} servicios
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {/* Alta rápida, igual que en productos: toma el término de búsqueda
                  como nombre tentativo. */}
              <button
                type="button"
                onClick={() => setCreating(true)}
                className={cn(
                  CARD_BASE,
                  'border-dashed border-gold/40 bg-gold/[0.06] text-gold-100',
                )}
              >
                <Plus className="h-5 w-5" />
                {q.trim() ? `Crear "${q.trim()}"` : 'Nuevo servicio'}
              </button>
              {list.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setService(s)}
                  className={CARD_BASE}
                >
                  <span className="line-clamp-3">{s.name}</span>
                  <span className="text-[13px] font-semibold text-gold-200">
                    {money(s.base_price)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
        </>
      )}
    </Modal>
  );
}

/**
 * Agregar producto: tarjetas con precio, una sola pulsación. La cantidad se
 * ajusta después en la línea, que ya tiene su control de −/+.
 */
function AddProductSheet({
  open,
  onClose,
  products,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  onAdd: (pid: string, qty: number, product?: Product) => void;
}) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const createProduct = useCreateProduct();

  const list = useMemo(() => {
    const term = normalizeText(q);
    if (!term) return products;
    return products.filter(
      (p) => normalizeText(p.name).includes(term) || normalizeText(p.sku ?? '').includes(term),
    );
  }, [products, q]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={creating ? 'Nuevo producto' : 'Agregar producto'}
      className="sm:max-w-2xl"
    >
      {creating ? (
        <NewProductForm
          initialName={q.trim()}
          saving={createProduct.isPending}
          error={
            createProduct.isError
              ? 'No se pudo guardar el producto. Reintentá.'
              : ''
          }
          onCancel={() => setCreating(false)}
          onSubmit={(draft) => {
            void createProduct
              .mutateAsync(draft)
              // Se pasa la fila entera: el contenedor todavía tiene en memoria el
              // catálogo anterior y no encontraría el id recién creado.
              .then((p) => onAdd(p.id, 1, p))
              .catch(() => {
                /* el aviso ya lo da createProduct.isError en el formulario */
              });
          }}
        />
      ) : (
        <>
          <SheetSearch value={q} onChange={setQ} placeholder="Buscar producto…" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {/* Alta rápida: el catálogo se arma sobre la marcha, sin salir de
                la venta. */}
            <button
              type="button"
              onClick={() => setCreating(true)}
              className={cn(
                CARD_BASE,
                'border-dashed border-gold/40 bg-gold/[0.06] text-gold-100',
              )}
            >
              <Plus className="h-5 w-5" />
              {q.trim() ? `Crear "${q.trim()}"` : 'Nuevo producto'}
            </button>
            {list.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onAdd(p.id, 1)}
                className={CARD_BASE}
              >
                <span className="line-clamp-3">{p.name}</span>
                <span className="text-[13px] font-semibold text-gold-200">
                  {money(p.base_price)}
                </span>
              </button>
            ))}
          </div>
          {products.length === 0 && (
            <p className="mt-3 text-center text-sm text-white/40">
              Todavía no hay productos cargados: creá el primero acá.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

/** Alta mínima de producto: lo indispensable para poder cobrarlo hoy. */
function NewProductForm({
  initialName,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  initialName: string;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (draft: NewProductDraft) => void;
}) {
  const [name, setName] = useState(initialName);
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');

  const priceNum = Number(price.replace(',', '.')) || 0;
  const costNum = Number(cost.replace(',', '.')) || 0;
  const ready = name.trim().length > 0 && priceNum > 0;

  return (
    <div className="space-y-3">
      <Input
        label="Nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ej: Shampoo matizante"
      />
      <div>
        <Input
          label="SKU (opcional)"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="Ej: SH-MAT-250"
        />
        <p className="mt-1 text-xs text-white/40">
          Abreviación o código con el que lo reconocés; también sirve para
          buscarlo.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Precio de venta"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0,00"
        />
        <Input
          label="Precio de costo"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder="0,00"
        />
      </div>
      <p className="text-xs text-white/40">
        Se guarda por unidad. Si lo vendés por ml o g, cambiá la unidad en
        Configuración → Productos.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          disabled={!ready || saving}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              sku: sku.trim() || null,
              base_price: priceNum,
              cost_price: costNum,
            })
          }
        >
          <Plus className="h-4 w-4" />
          {saving ? 'Guardando…' : 'Crear y agregar'}
        </Button>
      </div>
    </div>
  );
}

/** Alta mínima de servicio: lo indispensable para poder cobrarlo hoy. */
function NewServiceForm({
  initialName,
  initialCategory,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  initialName: string;
  initialCategory: string;
  saving: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (draft: NewServiceDraft) => void;
}) {
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState(initialCategory);
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');

  const priceNum = Number(price.replace(',', '.')) || 0;
  const durationNum = Number(duration) || 0;
  const ready = name.trim().length > 0 && priceNum > 0;

  return (
    <div className="space-y-3">
      <Input
        label="Nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ej: Corte y peinado"
      />
      <Select
        label="Categoría"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="">Sin categoría</option>
        {SERVICE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Precio de venta"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0,00"
        />
        <Input
          label="Duración (min, opcional)"
          type="number"
          inputMode="numeric"
          min="0"
          step="5"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder="Ej: 45"
        />
      </div>
      <p className="text-xs text-white/40">
        El resto del detalle se completa en Configuración → Servicios.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          disabled={!ready || saving}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              category: category.trim() || null,
              base_price: priceNum,
              duration_minutes: durationNum > 0 ? durationNum : null,
            })
          }
        >
          <Plus className="h-4 w-4" />
          {saving ? 'Guardando…' : 'Crear y continuar'}
        </Button>
      </div>
    </div>
  );
}
