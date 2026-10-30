import type { ReactNode } from 'react';
import { SubNavTabs, type SubNavTab } from '@/components/ui';
import { ROUTES } from '@/config/constants';
import { hasPermission } from '@/config/permissions';
import { useSession } from '@/store/session';

/**
 * Encabezado común de las tres pantallas de Equipo: título, acción principal
 * y pestañas para saltar entre Comisiones, Miembros y Ausencias (cada una
 * filtrada por el mismo permiso que protege su ruta).
 */
export function StaffShell({
  action,
  children,
}: {
  action?: ReactNode;
  children: ReactNode;
}) {
  const role = useSession((s) => s.user?.role);
  const tabs: SubNavTab[] = [
    ...(hasPermission(role, 'view_staff_finance')
      ? [{ path: ROUTES.staff, label: 'Comisiones', end: true }]
      : []),
    ...(hasPermission(role, 'manage_staff')
      ? [{ path: ROUTES.staffTeam, label: 'Miembros' }]
      : []),
    ...(hasPermission(role, 'view_staff_finance')
      ? [{ path: ROUTES.staffAbsences, label: 'Ausencias y cierres' }]
      : []),
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-white sm:text-2xl">Equipo</h1>
        {action}
      </div>
      {tabs.length > 1 && <SubNavTabs tabs={tabs} />}
      {children}
    </div>
  );
}
