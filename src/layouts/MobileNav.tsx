import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  CalendarRange,
  ShoppingCart,
  MoreHorizontal,
  Plus,
  Wallet,
  Contact,
  ClipboardList,
  BellRing,
  Users,
  FileText,
  Settings,
  BarChart3,
  LogOut,
} from 'lucide-react';
import { ROUTES } from '@/config/constants';
import { useSession } from '@/store/session';
import { fullName } from '@/lib/format';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/cn';

/** Pestañas principales: lo que se usa todos los días. El resto vive en "Más". */
const TABS = [
  { to: ROUTES.dashboard, label: 'Inicio', icon: CalendarRange, end: true },
  { to: ROUTES.calendar, label: 'Agenda', icon: CalendarDays },
  { to: ROUTES.pos, label: 'POS', icon: ShoppingCart },
];

const MORE = [
  { to: ROUTES.metrics, label: 'Métricas', icon: BarChart3 },
  { to: ROUTES.tasks, label: 'Tablero', icon: ClipboardList },
  { to: ROUTES.cashflow, label: 'Finanzas', icon: Wallet },
  { to: ROUTES.clients, label: 'Clientes', icon: Contact },
  { to: ROUTES.reminders, label: 'Recordatorios', icon: BellRing },
  { to: ROUTES.staff, label: 'Personal', icon: Users },
  { to: ROUTES.invoices, label: 'Facturación', icon: FileText },
  { to: ROUTES.settings, label: 'Configuración', icon: Settings },
];

/**
 * Navegación inferior (móvil): 4 destinos frecuentes + botón central para
 * agendar, que es la acción más repetida del día. El resto de secciones se
 * abren en una hoja inferior, al alcance del pulgar.
 */
export function MobileNav() {
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const { user, logout } = useSession();

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors',
      isActive ? 'text-gold-300' : 'text-white/50',
    );

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-white/10 bg-ink-900/95 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {TABS.slice(0, 2).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={tabClass}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}

        {/* Acción central: agendar cita */}
        <div className="relative w-16 shrink-0">
          <button
            onClick={() => navigate(ROUTES.appointmentNew)}
            aria-label="Agendar cita"
            className="absolute -top-5 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-2xl bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 shadow-gold-glow transition active:scale-95"
          >
            <Plus className="h-7 w-7" strokeWidth={2.5} />
          </button>
        </div>

        {TABS.slice(2).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={tabClass}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}

        <button
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium text-white/50"
        >
          <MoreHorizontal className="h-5 w-5" />
          Más
        </button>
      </nav>

      <Modal
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="Menú"
        className="sm:max-w-md"
      >
        <div className="grid grid-cols-3 gap-2">
          {MORE.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-2xl border p-2 text-center text-xs font-medium transition active:scale-[0.97]',
                  isActive
                    ? 'border-gold/50 bg-gold/15 text-gold-100'
                    : 'border-white/10 bg-white/[0.03] text-white/75',
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>

        <button
          onClick={() => {
            setMoreOpen(false);
            logout();
          }}
          className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-white">
              {user ? fullName(user.full_name) : 'Sesión'}
            </span>
            <span className="block text-xs capitalize text-white/40">
              {user?.role ?? '—'}
            </span>
          </span>
          <LogOut className="h-5 w-5 shrink-0 text-white/50" />
        </button>
      </Modal>
    </>
  );
}
