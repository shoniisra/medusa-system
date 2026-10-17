import { queryOne } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { waitForLogout } from '@/store/session';
import type { AppUser } from '@/types';

/** Devuelve el usuario verificado; nunca toma el rol del selector en caché. */
export async function authenticateUser(
  userId: string, orgId: string, branchId: string, password: string,
): Promise<AppUser> {
  await waitForLogout();
  let user: AppUser | undefined;
  if (import.meta.env.DEV) {
    const row = await queryOne<AppUser & { password_hash: string | null }>(
      `SELECT id, organization_id, username, full_name, email, phone, role,
              active, last_login_at, created_at, updated_at, password_hash
         FROM app_user WHERE id = ? AND organization_id = ? AND active = 1`,
      [userId, orgId],
    );
    if (!row?.password_hash) throw new Error('Usuario sin token configurado.');
    if (!(await verifyPassword(password, row.password_hash))) throw new Error('Token incorrecto.');
    const { password_hash: _hash, ...safeUser } = row;
    user = { ...safeUser, has_password: 1 };
  } else {
    const response = await fetch('/api/login', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId, org_id: orgId, branch_id: branchId, password }),
    });
    const data = await response.json().catch(() => ({})) as { user?: AppUser; error?: string };
    if (!response.ok) throw new Error(data.error ?? 'No se pudo iniciar sesión.');
    user = data.user;
  }
  if (!user || user.id !== userId || user.organization_id !== orgId || user.active !== 1 ||
      !['admin', 'manager', 'cashier', 'staff'].includes(user.role)) {
    throw new Error('El usuario autenticado no coincide con la sesión solicitada.');
  }
  return user;
}
