import { useQuery } from '@tanstack/react-query';
import { query } from '@/lib/db';
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
