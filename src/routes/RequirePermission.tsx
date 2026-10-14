import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '@/store/session';
import { hasPermission, type Permission } from '@/config/permissions';
import { ROUTES } from '@/config/constants';

interface Props {
  permission: Permission;
  /** Ruta a la que redirigir si no tiene permiso. Default: dashboard. */
  redirectTo?: string;
}

/**
 * Bloquea rutas que requieren un permiso concreto. Si el usuario no lo tiene,
 * redirige silenciosamente al dashboard (o a `redirectTo`).
 */
export function RequirePermission({ permission, redirectTo = ROUTES.dashboard }: Props) {
  const role = useSession((s) => s.user?.role);
  if (!hasPermission(role, permission)) {
    return <Navigate to={redirectTo} replace />;
  }
  return <Outlet />;
}
