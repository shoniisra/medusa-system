import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { execute, query } from '@/lib/db';
import { genId } from '@/lib/format';
import { useOrgId } from '@/store/session';
import type { Customer, Product, Service, StaffMember } from '@/types';

/** Catálogo compartido del POS: servicios, productos, clientes y personal. */
export function useServices() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['services', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<Service>(
        'SELECT * FROM service WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });
}

export function useProducts() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['products', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<Product>(
        'SELECT * FROM product WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });
}

export function useCustomers() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['customers', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<Customer>(
        'SELECT * FROM customer WHERE organization_id = ? AND active = 1 ORDER BY first_name',
        [orgId],
      ),
  });
}

export function useStaff() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['staff', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffMember>(
        'SELECT * FROM staff_member WHERE organization_id = ? AND active = 1 ORDER BY first_name',
        [orgId],
      ),
  });
}

/** Datos mínimos para dar de alta un producto desde el mostrador. */
export interface NewProductDraft {
  name: string;
  sku: string | null;
  base_price: number;
  cost_price: number;
}

/**
 * Alta rápida de producto durante una venta. La unidad queda fija en `unit`:
 * en el salón casi todo se vende por pieza, y quien necesite ml o g lo corrige
 * en Configuración → Productos.
 *
 * Deja la fila en la caché de `useProducts` antes de resolver, así quien la
 * llama puede agregarla a la venta enseguida sin esperar el refetch.
 */
export function useCreateProduct() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: NewProductDraft): Promise<Product> => {
      const now = new Date().toISOString();
      const row: Product = {
        id: genId(),
        organization_id: orgId,
        sku: draft.sku?.trim() || null,
        name: draft.name.trim(),
        description: null,
        unit: 'unit',
        cost_price: draft.cost_price,
        base_price: draft.base_price,
        active: 1,
        created_at: now,
        updated_at: now,
      };
      await execute(
        `INSERT INTO product
           (id, organization_id, sku, name, description, unit,
            cost_price, base_price, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          row.id,
          row.organization_id,
          row.sku,
          row.name,
          row.description,
          row.unit,
          row.cost_price,
          row.base_price,
          row.created_at,
          row.updated_at,
        ],
      );
      return row;
    },
    onSuccess: (p) => {
      qc.setQueryData<Product[]>(['products', orgId], (old) =>
        [...(old ?? []), p].sort((a, b) => a.name.localeCompare(b.name)),
      );
      qc.invalidateQueries({ queryKey: ['products', orgId] });
    },
  });
}
