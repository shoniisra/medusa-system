import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppUser, Branch, CashSession, Organization } from '@/types';
import { queryClient } from '@/lib/queryClient';
import { usePosDraft } from './posDraft';

let pendingLogout: Promise<unknown> = Promise.resolve();

/** Evita que una respuesta tardía de logout borre la cookie del nuevo login. */
export async function waitForLogout(): Promise<void> {
  await pendingLogout;
}

function clearSessionData() {
  queryClient.clear();
  usePosDraft.getState().reset();
}

const EMPTY_SESSION = { user: null, organization: null, branch: null, cashSession: null };

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

      setSession: ({ user, organization, branch }) => {
        clearSessionData();
        set({ user, organization, branch, cashSession: null });
      },
      setBranch: (branch) => set({ branch, cashSession: null }),
      setCashSession: (cashSession) => set({ cashSession }),
      logout: () => {
        set(EMPTY_SESSION);
        clearSessionData();
        pendingLogout = fetch('/api/logout', { method: 'POST', credentials: 'include' })
          .catch(() => undefined);
      },

      isAuthenticated: () => get().user !== null,
      hasOpenCash: () => get().cashSession?.status === 'open',
    }),
    {
      name: 'medusa-session',
      // Invalidar sesiones anteriores que pudieron persistir un rol del caché.
      version: 1,
      migrate: () => EMPTY_SESSION,
      partialize: ({ user, organization, branch, cashSession }) => ({
        user, organization, branch, cashSession,
      }),
    },
  ),
);

/* Selectores de conveniencia (evitan re-render de todo el store). */
export const useBranchId = () => useSession((s) => s.branch?.id ?? '');
export const useOrgId = () => useSession((s) => s.organization?.id ?? '');
