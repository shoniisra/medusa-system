import { useMemo, useState } from 'react';
import {
  Plus,
  Minus,
  Trash2,
  Scissors,
  Package,
  Search,
  ChevronLeft,
} from 'lucide-react';
import { money, num, fullName } from '@/lib/format';
import { SERVICE_CATEGORIES } from '@/config/constants';
import { cn } from '@/lib/cn';
import { Button, Card, CardHeader, Input, Modal, Select } from '@/components/ui';
import { commissionForItem, type CommissionRule } from './createSale';
import { useCreateProduct, type NewProductDraft } from './useCatalog';
import type { CommissionType, Product, Service, StaffMember } from '@/types';
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
          return (
            <div
              key={i.id}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
              style={{
                borderLeft: `3px solid ${
                  assignable ? i.staff_color || '#64748b' : 'transparent'
                }`,
              }}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-[15px] font-medium text-white">
                  <InlineEdit
                    value={i.description}
                    align="left"
                    onCommit={(v) =>
                      v.trim() && onUpdateItem(i.id, { description: v.trim() })
                    }
                  />
                </div>
                <button
                  onClick={() => onRemoveItem(i.id)}
                  aria-label="Eliminar ítem"
                  className="tap -mr-1 flex shrink-0 items-center justify-center rounded-lg text-white/40 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {placeholder && (
                <div className="mt-2 space-y-1">
                  <ServicePicker
                    item={i}
                    services={services}
                    onPick={(patch) => onUpdateItem(i.id, patch)}
                  />
                  <p className="text-[11px] text-amber-300/80">
                    Reservado por categoría: elegí el servicio para poder cobrar.
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
                    {c.commission_type === 'percentage'
                      ? `${num(c.commission_rate)}% · ${money(c.commission_amount)}`
                      : money(c.commission_amount)}
                  </span>
                </p>
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
                    {placeholder ? (
                      <ServicePicker
                        item={i}
                        services={services}
                        onPick={(patch) => onUpdateItem(i.id, patch)}
                      />
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
          onAdd={(sid, stid) => {
            onAddService({ sid, stid });
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
      className="border-amber-400/40"
    >
      <option value="">
        {item.category ? `Elegí servicio de ${item.category}…` : 'Elegí servicio…'}
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
  onAdd: (sid: string, stid: string | null) => void;
}) {
  const [category, setCategory] = useState('');
  const [service, setService] = useState<Service | null>(null);
  const [q, setQ] = useState('');

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

  const title =
    step === 'staff'
      ? '¿Quién lo hace?'
      : step === 'service'
        ? category || 'Buscar servicio'
        : 'Agregar servicio';

  return (
    <Modal open={open} onClose={onClose} title={title} className="sm:max-w-2xl">
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
              onClick={() => onAdd(service.id, null)}
              className={cn(CARD_BASE, 'text-white/60')}
            >
              Sin asignar
            </button>
            {staff.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onAdd(service.id, s.id)}
                className={CARD_BASE}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: s.color || '#64748b' }}
                />
                {fullName(s.first_name, s.last_name)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <SheetSearch value={q} onChange={setQ} placeholder="Buscar servicio…" />
          {step === 'category' ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
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
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-white/40">
              Sin servicios que coincidan.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
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
