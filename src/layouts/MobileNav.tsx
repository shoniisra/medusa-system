import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CalendarPlus,
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
  History,
  Receipt,
  Star,
} from "lucide-react";
import { ROUTES } from "@/config/constants";
import { useSession } from "@/store/session";
import { fullName } from "@/lib/format";
import { Modal } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useHasPermission } from "@/config/permissions";

type NavEntry = {
  to: string;
  label: string;
  icon: typeof CalendarDays;
  end?: boolean;
};

/**
 * Navegación inferior (móvil): 4 destinos frecuentes + botón central para
 * agendar, que es la acción más repetida del día. El resto de secciones se
 * abren en una hoja inferior, al alcance del pulgar.
 */
export function MobileNav() {
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const { user, logout } = useSession();
  const role = useSession((s) => s.user?.role);
  const can = useHasPermission(role);

  const TABS: NavEntry[] = [
    { to: ROUTES.dashboard, label: "Inicio", icon: CalendarRange, end: true },
    { to: ROUTES.calendar, label: "Agenda", icon: CalendarDays },
    ...(can("use_pos")
      ? [{ to: ROUTES.pos, label: "POS", icon: ShoppingCart }]
      : []),
  ];

  const MORE: NavEntry[] = [
    ...(can("view_own_summary")
      ? [{ to: ROUTES.myServices, label: "Mis servicios", icon: Star }]
      : []),
    ...(can("view_metrics")
      ? [{ to: ROUTES.metrics, label: "Métricas", icon: BarChart3 }]
      : []),
    { to: ROUTES.tasks, label: "Tablero", icon: ClipboardList },
    { to: ROUTES.history, label: "Historial", icon: History },
    ...(can("view_finance")
      ? [{ to: ROUTES.cashflow, label: "Finanzas", icon: Wallet }]
      : []),
    { to: ROUTES.clients, label: "Clientes", icon: Contact },
    { to: ROUTES.reminders, label: "Recordatorios", icon: BellRing },
    ...(can("view_staff_finance")
      ? [{ to: ROUTES.staff, label: "Personal", icon: Users }]
      : []),
    ...(can("view_invoices")
      ? [{ to: ROUTES.invoices, label: "Facturación", icon: FileText }]
      : []),
    ...(can("manage_settings")
      ? [{ to: ROUTES.settings, label: "Configuración", icon: Settings }]
      : []),
  ];

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
      isActive ? "text-gold-300" : "text-white/50",
    );

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-white/10 bg-ink-900/95 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.slice(0, 2).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={tabClass}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}

        {/* Acción central FAB */}
        <div className="relative w-16 shrink-0">
          <button
            onClick={() => setNewOpen(true)}
            aria-label="Nuevo"
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
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Nuevo"
        className="sm:max-w-sm"
      >
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => {
              setNewOpen(false);
              navigate(ROUTES.appointmentNew);
            }}
            className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm font-medium text-white/85 active:scale-[0.97]"
          >
            <CalendarPlus className="h-6 w-6 text-gold-300" />
            Agendar Cita
          </button>
          {can("use_pos") && (
            <button
              onClick={() => {
                setNewOpen(false);
                navigate(ROUTES.pos);
              }}
              className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm font-medium text-white/85 active:scale-[0.97]"
            >
              <ShoppingCart className="h-6 w-6 text-gold-300" />
              Nueva venta
            </button>
          )}
          {can("view_finance") && (
            <button
              onClick={() => {
                setNewOpen(false);
                navigate(`${ROUTES.cashflow}?nuevo=gasto`);
              }}
              className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm font-medium text-white/85 active:scale-[0.97]"
            >
              <Receipt className="h-6 w-6 text-gold-300" />
              Registrar gasto
            </button>
          )}
        </div>
      </Modal>

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
                  "flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-2xl border p-2 text-center text-xs font-medium transition active:scale-[0.97]",
                  isActive
                    ? "border-gold/50 bg-gold/15 text-gold-100"
                    : "border-white/10 bg-white/[0.03] text-white/75",
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
              {user ? fullName(user.full_name) : "Sesión"}
            </span>
            <span className="block text-xs capitalize text-white/40">
              {user?.role ?? "—"}
            </span>
          </span>
          <LogOut className="h-5 w-5 shrink-0 text-white/50" />
        </button>
      </Modal>
    </>
  );
}
