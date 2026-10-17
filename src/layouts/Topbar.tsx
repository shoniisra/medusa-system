import { useState } from 'react';
import { LogOut, Building2, CircleDot, Wallet, ChevronsUpDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSession, useBranchId } from '@/store/session';
import { fullName } from '@/lib/format';
import { query } from '@/lib/db';
import { CashRegisterModal } from '@/features/cashflow/CashRegisterModal';
import { useBranchCashSession } from '@/features/cashflow/cashSessionActions';
import { Modal, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { roleLabel } from '@/config/permissions';
import type { Branch } from '@/types';

export function Topbar() {
  const { user, branch, logout, setBranch } = useSession();
  const branchId = useBranchId();
  const [cashOpen, setCashOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  const { session } = useBranchCashSession(branchId);
  const isOpen = !!session;

  // Sucursales accesibles por este usuario (requiere tabla user_branch_access).
  const branchAccess = useQuery({
    queryKey: ['user-branch-access', user?.id],
    enabled: !!user?.id,
    queryFn: () =>
      query<Branch>(
        `SELECT b.*
           FROM branch b
           JOIN user_branch_access uba ON uba.branch_id = b.id
          WHERE uba.user_id = ? AND b.active = 1
          ORDER BY b.name`,
        [user!.id],
      ).catch(() => [] as Branch[]), // tabla puede no existir todavía en dev
  });

  const canSwitchBranch = (branchAccess.data?.length ?? 0) > 1;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/5 bg-ink-900/60 px-4 backdrop-blur-xl lg:h-16 lg:px-6">
      {/* Sucursal actual + botón cambiar */}
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
        {canSwitchBranch && (
          <button
            type="button"
            onClick={() => setBranchOpen(true)}
            title="Cambiar de sucursal"
            className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/50 transition-colors hover:border-white/20 hover:bg-white/5 hover:text-white"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Cambiar</span>
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setCashOpen(true)}
          title={isOpen ? 'Cerrar caja' : 'Abrir caja'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition active:scale-95',
            isOpen
              ? 'border-success/40 bg-success/15 text-success hover:bg-success/25'
              : 'border-white/15 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white',
          )}
        >
          {isOpen ? (
            <CircleDot className="h-3 w-3" />
          ) : (
            <Wallet className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">
            {isOpen ? 'Caja abierta' : 'Abrir caja'}
          </span>
          <span className="sm:hidden">Caja</span>
        </button>

        <div className="hidden text-right lg:block">
          <p className="text-sm font-medium text-white">
            {user ? fullName(user.full_name) : '—'}
          </p>
          <p className="text-xs text-white/40">{roleLabel(user?.role)}</p>
        </div>

        <button
          onClick={logout}
          title="Cerrar sesión"
          className="hidden rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white lg:block"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      <CashRegisterModal open={cashOpen} onClose={() => setCashOpen(false)} />

      {/* Modal cambiar de sucursal */}
      {branchOpen && (
        <Modal open onClose={() => setBranchOpen(false)} title="Cambiar de sucursal">
          <div className="space-y-2">
            {branchAccess.data?.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setBranch(b);
                  setBranchOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                  b.id === branchId
                    ? 'border-gold/40 bg-gold/10 text-gold-200'
                    : 'border-white/10 text-white hover:bg-white/5',
                )}
              >
                <Building2 className="h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">{b.name}</p>
                  {b.id === branchId && (
                    <p className="text-xs text-gold-400">Sucursal actual</p>
                  )}
                </div>
              </button>
            ))}
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setBranchOpen(false)}
            >
              Cancelar
            </Button>
          </div>
        </Modal>
      )}
    </header>
  );
}
