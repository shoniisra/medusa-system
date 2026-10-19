import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '@/store/session';
import { canViewClients } from '@/lib/perms';
import { ROUTES } from '@/config/constants';

/**
 * Bloquea el directorio y la ficha de clientes para roles sin acceso
 * (cajera/recepcionista). Si entran por URL directa, los devuelve al tablero.
 */
export function RequireClientsAccess() {
  const role = useSession((s) => s.user?.role);
  if (!canViewClients(role)) return <Navigate to={ROUTES.dashboard} replace />;
  return <Outlet />;
}
