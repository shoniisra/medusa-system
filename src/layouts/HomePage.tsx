import { useEffect, useState } from 'react';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { StaffDashboardPage } from '@/features/dashboard/StaffDashboardPage';
import { CalendarViewPage } from '@/features/calendar/CalendarViewPage';
import { useSession } from '@/store/session';
import { hasPermission } from '@/config/permissions';

/**
 * Pantalla principal.
 *
 * - `staff` y `cashier` ven su tablero personal (comisiones, saldo, citas): la
 *   cajera también es colaboradora, así que al entrar quiere lo suyo, no el
 *   calendario del salón.
 * - En móvil, los roles con `view_metrics` (admin/gerente) ven el calendario a
 *   pantalla completa — lo que la mayoría del tiempo necesitan a mano.
 * - En escritorio, admin y gerente ven el tablero gerencial.
 */
export function HomePage() {
  const role = useSession((s) => s.user?.role ?? null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023.98px)');
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (!role) return null;
  if (role === 'staff' || role === 'cashier') return <StaffDashboardPage />;
  if (isMobile || !hasPermission(role, 'view_metrics')) return <CalendarViewPage />;
  return <DashboardPage />;
}
