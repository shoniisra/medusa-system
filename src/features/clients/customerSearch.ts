import { fullName } from '@/lib/format';
import type { Customer } from '@/types';

/**
 * Clientes que coinciden con lo que se escribió en el buscador, por nombre o por
 * teléfono. Devuelve vacío sin búsqueda: la lista completa no es una sugerencia.
 * La usan el paso de cliente de Nueva venta y el de Reservar.
 */
export function searchCustomers<T extends Customer>(
  list: readonly T[],
  search: string,
  limit = 8,
): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return [];
  return list
    .filter(
      (c) =>
        fullName(c.first_name, c.last_name).toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q),
    )
    .slice(0, limit);
}
