import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingBag,
  Wallet,
  CalendarDays,
  Contact,
} from 'lucide-react';
import { ROUTES } from '@/config/constants';
import { cn } from '@/lib/cn';

const NAV = [
  { to: ROUTES.dashboard, label: 'Inicio', icon: LayoutDashboard, end: true },
  { to: ROUTES.pos, label: 'Venta', icon: ShoppingBag },
  { to: ROUTES.cashflow, label: 'Caja', icon: Wallet },
  { to: ROUTES.calendar, label: 'Agenda', icon: CalendarDays },
  { to: ROUTES.clients, label: 'Clientes', icon: Contact },
];

/** Barra de navegación inferior para móvil. */
export function MobileNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-white/10 bg-ink-900/90 backdrop-blur-xl lg:hidden">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px]',
              isActive ? 'text-gold-300' : 'text-white/50',
            )
          }
        >
          <Icon className="h-5 w-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
