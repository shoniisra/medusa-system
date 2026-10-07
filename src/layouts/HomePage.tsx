import { useEffect, useState } from 'react';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { CalendarViewPage } from '@/features/calendar/CalendarViewPage';

/**
 * Pantalla principal: en escritorio, el tablero con las métricas; en móvil, el
 * calendario a pantalla completa — lo que la mayoría del tiempo necesita ver,
 * agendar, atender y vender sin cita. Las métricas quedan a un clic en
 * "Ver tus métricas" del cierre de caja y en Finanzas → Resumen.
 */
export function HomePage() {
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

  return isMobile ? <CalendarViewPage /> : <DashboardPage />;
}
