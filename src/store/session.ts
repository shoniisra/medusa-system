import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppUser, Branch, CashSession, Organization } from '@/types';

/**
 * Estado global de sesión: usuario activo, organización, sucursal actual y
 * sesión de caja abierta. El dashboard y la caja SIEMPRE filtran por
 * `branch` + `cashSession` activos.
 */
interface SessionState {
  user: AppUser | null;
  organization: Organization | null;
  branch: Branch | null;
  cashSession: CashSession | null;

  setSession: (data: {
    user: AppUser;
    organization: Organization;
    branch: Branch;
  }) => void;
  setBranch: (branch: Branch) => void;
  setCashSession: (session: CashSession | null) => void;
  logout: () => void;

  isAuthenticated: () => boolean;
  hasOpenCash: () => boolean;
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      user: null,
      organization: null,
      branch: null,
      cashSession: null,

      setSession: ({ user, organization, branch }) =>
        set({ user, organization, branch }),
      setBranch: (branch) => set({ branch, cashSession: null }),
      setCashSession: (cashSession) => set({ cashSession }),
      logout: () =>
        set({
          user: null,
          organization: null,
          branch: null,
          cashSession: null,
        }),

      isAuthenticated: () => get().user !== null,
      hasOpenCash: () => get().cashSession?.status === 'open',
    }),
    { name: 'medusa-session' },
  ),
);

/* Selectores de conveniencia (evitan re-render de todo el store). */
export const useBranchId = () => useSession((s) => s.branch?.id ?? '');
export const useOrgId = () => useSession((s) => s.organization?.id ?? '');
export const useCashSessionId = () =>
  useSession((s) => s.cashSession?.id ?? null);
