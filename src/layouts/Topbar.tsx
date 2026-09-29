import { LogOut, Building2, CircleDot } from 'lucide-react';
import { useSession } from '@/store/session';
import { fullName } from '@/lib/format';
import { Badge } from '@/components/ui';

export function Topbar() {
  const { user, branch, cashSession, logout } = useSession();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/5 bg-ink-900/60 px-4 backdrop-blur-xl lg:h-16 lg:px-6">
      {/* Marca (solo móvil: el sidebar ya la muestra en escritorio) + sucursal */}
      <div className="flex min-w-0 items-center gap-2">
        <img
          src="/medusa-logo.jpg"
          alt=""
          className="h-8 w-8 shrink-0 rounded-lg lg:hidden"
        />
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-white/70">
          <Building2 className="hidden h-4 w-4 shrink-0 text-gold-300 lg:block" />
          <span className="truncate font-medium">
            {branch?.name ?? 'Sin sucursal'}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {/* Estado de caja */}
        {cashSession?.status === 'open' ? (
          <Badge tone="success">
            <CircleDot className="mr-1 h-3 w-3" />{' '}
            <span className="hidden sm:inline">Caja abierta</span>
            <span className="sm:hidden">Caja</span>
          </Badge>
        ) : (
          <Badge tone="muted">
            <span className="hidden sm:inline">Caja cerrada</span>
            <span className="sm:hidden">Caja</span>
          </Badge>
        )}

        {/* Usuario (escritorio; en móvil vive en la hoja "Más") */}
        <div className="hidden text-right lg:block">
          <p className="text-sm font-medium text-white">
            {user ? fullName(user.full_name) : '—'}
          </p>
          <p className="text-xs capitalize text-white/40">{user?.role}</p>
        </div>

        <button
          onClick={logout}
          title="Cerrar sesión"
          className="hidden rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white lg:block"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
