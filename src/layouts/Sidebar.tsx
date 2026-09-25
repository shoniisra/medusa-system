import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Wallet,
  Users,
  Contact,
  CalendarDays,
  ClipboardList,
  FileText,
  Settings,
  BellRing,
} from 'lucide-react';
import { ROUTES, APP_NAME } from '@/config/constants';
import { query } from '@/lib/db';
import { useBranchId } from '@/store/session';
import { cn } from '@/lib/cn';

const NAV = [
  { to: ROUTES.dashboard, label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: ROUTES.calendar, label: 'Agenda', icon: CalendarDays },
  { to: ROUTES.tasks, label: 'Tareas', icon: ClipboardList },
  { to: ROUTES.reminders, label: 'Recordatorios', icon: BellRing },
  { to: ROUTES.cashflow, label: 'Finanzas', icon: Wallet },
  { to: ROUTES.staff, label: 'Personal', icon: Users },
  { to: ROUTES.clients, label: 'Clientes', icon: Contact },
  { to: ROUTES.invoices, label: 'Facturación', icon: FileText },
  { to: ROUTES.settings, label: 'Configuración', icon: Settings },
];

/** Cuenta de citas vencidas (reservadas/atendiendo de días pasados). */
function useOverdueCount(): number {
  const branchId = useBranchId();
  const q = useQuery({
    queryKey: ['overdue-count', branchId],
    enabled: !!branchId,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment
          WHERE branch_id = ? AND status IN ('reserved','confirmed')
            AND date(start_at) < date('now','localtime')`,
        [branchId],
      );
      return rows[0]?.n ?? 0;
    },
  });
  return q.data ?? 0;
}

/** Cuenta de citas de mañana (reservadas/atendiendo) pendientes de recordar. */
function useTomorrowCount(): number {
  const branchId = useBranchId();
  const q = useQuery({
    queryKey: ['tomorrow-count', branchId],
    enabled: !!branchId,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment
          WHERE branch_id = ? AND status IN ('reserved','confirmed')
            AND date(start_at) = date('now','localtime','+1 day')`,
        [branchId],
      );
      return rows[0]?.n ?? 0;
    },
  });
  return q.data ?? 0;
}

export function Sidebar() {
  const overdue = useOverdueCount();
  const tomorrow = useTomorrowCount();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-ink-900/80 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-2 px-6 py-6">
        <img
          src="/medusa-logo.jpg"
          alt="Medusa Estudio"
          className="h-8 w-8 rounded-lg"
        />
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
            <span className="flex-1">{label}</span>
            {to === ROUTES.tasks && overdue > 0 && (
              <span className="rounded-full bg-danger/20 px-2 py-0.5 text-xs font-medium text-danger">
                {overdue}
              </span>
            )}
            {to === ROUTES.reminders && tomorrow > 0 && (
              <span className="rounded-full bg-gold/20 px-2 py-0.5 text-xs font-medium text-gold-200">
                {tomorrow}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-6 py-4 text-xs text-white/30">MVP · v0.1</div>
    </aside>
  );
}
