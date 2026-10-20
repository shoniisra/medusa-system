import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { StaffDashboardPage } from '@/features/dashboard/StaffDashboardPage';
import { CalendarViewPage } from '@/features/calendar/CalendarViewPage';
import { useSession } from '@/store/session';
import { hasPermission } from '@/config/permissions';

/**
 * Pantalla principal.
 *
 * - `staff` y `cashier` ven su tablero personal (comisiones, saldo, citas).
 * - admin y gerente ven el tablero gerencial, tanto en escritorio como en móvil.
 * - cualquier otro rol sin `view_metrics` cae al calendario.
 */
export function HomePage() {
  const role = useSession((s) => s.user?.role ?? null);
  if (!role) return null;
  if (role === 'staff' || role === 'cashier') return <StaffDashboardPage />;
  if (!hasPermission(role, 'view_metrics')) return <CalendarViewPage />;
  return <DashboardPage />;
}
