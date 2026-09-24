import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '@/store/session';
import { ROUTES } from '@/config/constants';

/** Bloquea el acceso si no hay usuario ni sucursal en sesión. */
export function ProtectedRoute() {
  const authed = useSession((s) => s.user !== null && s.branch !== null);
  if (!authed) return <Navigate to={ROUTES.login} replace />;
  return <Outlet />;
}
