import type { Customer } from '@/types';

/**
 * Texto por el que se puede encontrar un contacto: nombre real, alias y nombre
 * con el que entró de la agenda. Los tres importan — la clienta que en la
 * factura es "María Gómez" en el salón es "Mica" y en el teléfono quedó como
 * "Mica uñas".
 */
export function customerHaystack(c: Customer): string {
  return [
    c.first_name,
    c.last_name,
    c.nickname,
    c.imported_name,
    c.phone,
    c.email,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Clientes que coinciden con lo que se escribió en el buscador, por nombre,
 * alias, nombre de la agenda o teléfono. Devuelve vacío sin búsqueda: la lista
 * completa no es una sugerencia. La usan el paso de cliente de Nueva venta y el
 * de Reservar.
 */
export function searchCustomers<T extends Customer>(
  list: readonly T[],
  search: string,
  limit = 8,
): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return [];
  return list.filter((c) => customerHaystack(c).includes(q)).slice(0, limit);
}
