import { waitForLogout } from '@/store/session';
import type { AppUser } from '@/types';

/** Devuelve el usuario verificado; nunca toma el rol del selector en caché. */
export async function authenticateUser(
  userId: string, orgId: string, branchId: string, password: string,
): Promise<AppUser> {
  await waitForLogout();
  const response = await fetch('/api/login', {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: userId, org_id: orgId, branch_id: branchId, password }),
  });
  const data = await response.json().catch(() => ({})) as { user?: AppUser; error?: string };
  if (!response.ok) throw new Error(data.error ?? 'No se pudo iniciar sesión.');
  const user = data.user;
  if (!user || user.id !== userId || user.organization_id !== orgId || user.active !== 1 ||
      !['admin', 'manager', 'cashier', 'staff'].includes(user.role)) {
    throw new Error('El usuario autenticado no coincide con la sesión solicitada.');
  }
  return user;
}
