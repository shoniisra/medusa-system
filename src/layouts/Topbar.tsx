import { LogOut, Building2, CircleDot } from 'lucide-react';
import { useSession } from '@/store/session';
import { fullName } from '@/lib/format';
import { Badge } from '@/components/ui';

export function Topbar() {
  const { user, branch, cashSession, logout } = useSession();

  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b border-white/5 bg-ink-900/60 px-4 backdrop-blur-xl lg:px-6">
      {/* Sucursal activa */}
      <div className="flex items-center gap-2 text-sm text-white/70">
        <Building2 className="h-4 w-4 text-gold-300" />
        <span className="font-medium">{branch?.name ?? 'Sin sucursal'}</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Estado de caja */}
        {cashSession?.status === 'open' ? (
          <Badge tone="success">
            <CircleDot className="mr-1 h-3 w-3" /> Caja abierta
          </Badge>
        ) : (
          <Badge tone="muted">Caja cerrada</Badge>
        )}

        {/* Usuario */}
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-white">
            {user ? fullName(user.full_name) : '—'}
          </p>
          <p className="text-xs capitalize text-white/40">{user?.role}</p>
        </div>

        <button
          onClick={logout}
          title="Cerrar sesión"
          className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
