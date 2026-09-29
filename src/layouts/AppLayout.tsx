import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import { ROUTES } from '@/config/constants';
import { cn } from '@/lib/cn';

/**
 * Contenedor principal: Sidebar (escritorio) + Topbar + área de contenido.
 *
 * Los flujos de cita (agendar / atender) son "inmersivos" en móvil: ocultan la
 * navegación inferior para que su propia barra de acción quede al alcance del
 * pulgar y no compita con las pestañas.
 */
export function AppLayout() {
  const { pathname } = useLocation();
  const immersive = pathname.startsWith(ROUTES.appointment);
  // El calendario administra su propio alto y scroll: sin padding ni scroll
  // de página, como una app de calendario nativa.
  const flush = pathname.startsWith(ROUTES.calendarView);

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main
          className={cn(
            'min-h-0 flex-1',
            flush
              ? 'overflow-hidden'
              : cn(
                  'overflow-y-auto overflow-x-hidden p-4 lg:p-6 lg:pb-6',
                  immersive
                    ? 'pb-4'
                    : 'pb-[calc(5rem+env(safe-area-inset-bottom))]',
                ),
          )}
        >
          <Outlet />
        </main>
        {!immersive && <MobileNav />}
      </div>
    </div>
  );
}
