import { queryOne } from '@/lib/db';

export interface CustomerHit {
  id: string;
  first_name: string;
  last_name: string | null;
}

/**
 * Busca un cliente activo por teléfono canónico dentro de la organización.
 * Se usa para bloquear duplicados antes de insertar. `canonical` debe venir ya
 * normalizado (E.164, ver lib/phone).
 */
export async function findCustomerByPhone(
  orgId: string,
  canonical: string,
): Promise<CustomerHit | null> {
  if (!canonical) return null;
  return queryOne<CustomerHit>(
    `SELECT id, first_name, last_name
       FROM customer
      WHERE organization_id = ? AND phone = ? AND active = 1
      LIMIT 1`,
    [orgId, canonical],
  );
}
