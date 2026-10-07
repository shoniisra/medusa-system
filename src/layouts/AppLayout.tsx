import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import {
  CashRegisterModal,
  useDailyCashGuard,
} from '@/features/cashflow/CashRegisterModal';
import { ROUTES } from '@/config/constants';
import { cn } from '@/lib/cn';

/**
 * Contenedor principal: Sidebar (escritorio) + Topbar + área de contenido.
 *
 * El guard diario abre el modal de caja al entrar al día: si quedó una caja
 * abierta de ayer o todavía no se abrió la de hoy, no deja seguir sin
 * resolverlo. En rutas inmersivas (una cita a pantalla completa) no interrumpe:
 * esos flujos ya están protegidos y la caja se abrirá al salir.
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

  const guard = useDailyCashGuard();
  // Si el usuario cierra el modal sin resolver, lo recordamos para el modo
  // actual: así no se reabre solo mientras siga igual. Al cambiar la
  // "necesidad" (p.ej. de retro → open después de cuadrar), el estado se
  // descarta y volvemos a mostrar el modal.
  const [dismissedMode, setDismissedMode] = useState<string | null>(null);
  const activeMode = !guard.loading && guard.needsAction ? guard.mode : null;
  const guardOpen =
    !!activeMode && !immersive && dismissedMode !== activeMode;

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

      <CashRegisterModal
        open={guardOpen}
        onClose={() => setDismissedMode(activeMode)}
        enforce
      />
    </div>
  );
}
