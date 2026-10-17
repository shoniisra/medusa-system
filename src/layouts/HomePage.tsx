import { useEffect, useState } from 'react';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { StaffDashboardPage } from '@/features/dashboard/StaffDashboardPage';
import { CalendarViewPage } from '@/features/calendar/CalendarViewPage';
import { useSession } from '@/store/session';

/**
 * Pantalla principal: en escritorio, el tablero con las métricas; en móvil, el
 * calendario a pantalla completa — lo que la mayoría del tiempo necesita ver,
 * agendar, atender y vender sin cita. Las métricas quedan a un clic en
 * "Ver tus métricas" del cierre de caja y en Finanzas → Resumen.
 *
 * Para el rol `staff` (colaboradora) el tablero muestra solo información
 * personal: sus ingresos, su saldo y sus citas — nada del resto del equipo.
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

  if (role === 'staff') return <StaffDashboardPage />;
  if (isMobile) return <CalendarViewPage />;
  return <DashboardPage />;
}
