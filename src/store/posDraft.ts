import { create } from 'zustand';
import type { DraftCommission, DraftSaleItem, LineAssist } from '@/types';
import { genId } from '@/lib/format';

/**
 * Borrador de venta del POS. La venta se arma en memoria (cliente + items +
 * distribución de comisiones) y recién al confirmar se persiste. Los pagos NO
 * viven acá: se registran contra la venta ya creada (regla venta ≠ pago).
 */
interface PosDraftState {
  customerId: string | null;
  requiresInvoice: boolean;
  items: DraftSaleItem[];

  setCustomer: (id: string | null) => void;
  setRequiresInvoice: (v: boolean) => void;
  addItem: (
    item: Omit<DraftSaleItem, 'tempId' | 'commissions' | 'assists'>,
  ) => void;
  removeItem: (tempId: string) => void;
  updateItem: (tempId: string, patch: Partial<DraftSaleItem>) => void;
  addCommission: (
    itemTempId: string,
    commission: Omit<DraftCommission, 'tempId'>,
  ) => void;
  removeCommission: (itemTempId: string, commissionTempId: string) => void;
  /** Ayudas (asistencias) de una línea: restan de la comisión del principal. */
  addAssist: (itemTempId: string, assist: Omit<LineAssist, 'id'>) => void;
  removeAssist: (itemTempId: string, assistId: string) => void;
  updateAssist: (
    itemTempId: string,
    assistId: string,
    patch: { label?: string; commission_amount?: number },
  ) => void;
  reset: () => void;

  subtotal: () => number;
  discountTotal: () => number;
  total: () => number;
}

export const usePosDraft = create<PosDraftState>((set, get) => ({
  customerId: null,
  requiresInvoice: false,
  items: [],

  setCustomer: (customerId) => set({ customerId }),
  setRequiresInvoice: (requiresInvoice) => set({ requiresInvoice }),

  addItem: (item) =>
    set((s) => ({
      items: [
        ...s.items,
        { ...item, tempId: genId(), commissions: [], assists: [] },
      ],
    })),

  removeItem: (tempId) =>
    set((s) => ({ items: s.items.filter((i) => i.tempId !== tempId) })),

  updateItem: (tempId, patch) =>
    set((s) => ({
      items: s.items.map((i) => (i.tempId === tempId ? { ...i, ...patch } : i)),
    })),

  addCommission: (itemTempId, commission) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.tempId === itemTempId
          ? {
              ...i,
              commissions: [
                ...i.commissions,
                { ...commission, tempId: genId() },
              ],
            }
          : i,
      ),
    })),

  removeCommission: (itemTempId, commissionTempId) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.tempId === itemTempId
          ? {
              ...i,
              commissions: i.commissions.filter(
                (c) => c.tempId !== commissionTempId,
              ),
            }
          : i,
      ),
    })),

  addAssist: (itemTempId, assist) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.tempId === itemTempId
          ? { ...i, assists: [...i.assists, { ...assist, id: genId() }] }
          : i,
      ),
    })),

  removeAssist: (itemTempId, assistId) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.tempId === itemTempId
          ? { ...i, assists: i.assists.filter((a) => a.id !== assistId) }
          : i,
      ),
    })),

  updateAssist: (itemTempId, assistId, patch) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.tempId === itemTempId
          ? {
              ...i,
              assists: i.assists.map((a) =>
                a.id === assistId ? { ...a, ...patch } : a,
              ),
            }
          : i,
      ),
    })),

  reset: () => set({ customerId: null, requiresInvoice: false, items: [] }),

  subtotal: () =>
    get().items.reduce((acc, i) => acc + i.list_unit_price * i.quantity, 0),
  discountTotal: () =>
    get().items.reduce((acc, i) => acc + i.discount_amount * i.quantity, 0),
  total: () =>
    get().items.reduce((acc, i) => acc + i.final_unit_price * i.quantity, 0),
}));
