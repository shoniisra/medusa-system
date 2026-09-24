import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingBag,
  Wallet,
  Users,
  Contact,
  CalendarDays,
  FileText,
  Settings,
  Scissors,
} from 'lucide-react';
import { ROUTES, APP_NAME } from '@/config/constants';
import { cn } from '@/lib/cn';

const NAV = [
  { to: ROUTES.dashboard, label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: ROUTES.pos, label: 'Punto de venta', icon: ShoppingBag },
  { to: ROUTES.cashflow, label: 'Caja', icon: Wallet },
  { to: ROUTES.calendar, label: 'Agenda', icon: CalendarDays },
  { to: ROUTES.clients, label: 'Clientes', icon: Contact },
  { to: ROUTES.staff, label: 'Personal', icon: Users },
  { to: ROUTES.invoices, label: 'Facturación', icon: FileText },
  { to: ROUTES.settings, label: 'Configuración', icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-ink-900/80 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-2 px-6 py-6">
        <Scissors className="h-6 w-6 text-gold-300" />
        <span className="brand-script text-3xl leading-none">{APP_NAME}</span>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-gold/10 text-gold-200 shadow-gold-glow'
                  : 'text-white/60 hover:bg-white/5 hover:text-white',
              )
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-6 py-4 text-xs text-white/30">MVP · v0.1</div>
    </aside>
  );
}
