import { queryOne } from '@/lib/db';
import { phoneDedupKey } from '@/lib/phone';
import type { Customer } from '@/types';

/**
 * Busca un cliente activo por teléfono canónico dentro de la organización.
 * Se usa para detectar duplicados antes de insertar. `canonical` debe venir ya
 * normalizado (E.164, ver lib/phone).
 *
 * Trae la fila completa porque quien encuentra el duplicado casi siempre quiere
 * hacer algo con él: combinarlo con la ficha que se está editando o usarlo tal
 * cual en vez de crear uno nuevo.
 */
export async function findCustomerByPhone(
  orgId: string,
  canonical: string,
): Promise<Customer | null> {
  if (!canonical) return null;
  return queryOne<Customer>(
    `SELECT * FROM customer
      WHERE organization_id = ? AND phone = ? AND active = 1
      LIMIT 1`,
    [orgId, canonical],
  );
}

/**
 * Dueño del número entre los contactos ya cargados en memoria, sin ir a la DB:
 * sirve para avisar en el momento en que se tipea, antes de intentar guardar.
 * Compara con `phoneDedupKey`, así que también pesca los registros viejos
 * guardados sin normalizar.
 */
export function phoneOwner<T extends { id: string; phone: string | null }>(
  list: T[],
  phone: string,
  exceptId?: string | null,
): T | null {
  const key = phoneDedupKey(phone);
  if (!key) return null;
  return (
    list.find((c) => c.id !== exceptId && phoneDedupKey(c.phone) === key) ?? null
  );
}
