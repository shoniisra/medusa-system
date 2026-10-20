import type { UserRole } from '@/types';

/**
 * Permisos por rol a nivel UI. Alinéalos con el backend cuando se mueva el
 * acceso al servidor: estos chequeos son solo de experiencia (ocultan navegación
 * y bloquean rutas) y no reemplazan la autorización real.
 */

/** Roles sin acceso al directorio de clientes ni a sus fichas. */
const ROLES_WITHOUT_CLIENTS: readonly UserRole[] = ['cashier', 'reception'];

/** La cajera/recepcionista cobra y agenda, pero no accede a la ficha de clientes. */
export function canViewClients(role: UserRole | undefined | null): boolean {
  if (!role) return false;
  return !ROLES_WITHOUT_CLIENTS.includes(role);
}
