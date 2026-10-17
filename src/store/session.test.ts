import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { useSession, waitForLogout } from './session';
import { usePosDraft } from './posDraft';
import type { AppUser, Branch, CashSession, Organization } from '@/types';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } } });
});

const organization = { id: 'org' } as Organization;
const branch = { id: 'branch', organization_id: 'org' } as Branch;
const kelly = { id: 'user_kelly', organization_id: 'org', role: 'manager', active: 1 } as AppUser;
const lesly = { id: 'user_leslie', organization_id: 'org', role: 'staff', active: 1 } as AppUser;

describe('aislamiento al cambiar de usuario', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    useSession.getState().setSession({ user: kelly, organization, branch });
  });
  afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });

  it('Kelly → salir → Lesly descarta métricas, caja, mutaciones y borrador anteriores', async () => {
    queryClient.setQueryData(['dashboard', 'branch'], { revenue: 9000 });
    queryClient.setQueryData(['login-users', 'org'], [kelly, { ...lesly, role: 'manager' }]);
    queryClient.getMutationCache().build(queryClient, {}, {
      status: 'success', data: { private: 'manager' }, error: null, context: undefined,
      failureCount: 0, failureReason: null, isPaused: false, variables: undefined, submittedAt: 0,
    });
    useSession.getState().setCashSession({ id: 'cash' } as CashSession);
    usePosDraft.getState().setCustomer('private-customer');
    useSession.getState().logout();
    expect(useSession.getState().user).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(usePosDraft.getState().customerId).toBeNull();
    await waitForLogout();
    useSession.getState().setSession({ user: lesly, organization, branch });
    expect(useSession.getState().user?.role).toBe('staff');
    expect(useSession.getState().cashSession).toBeNull();
    expect(queryClient.getQueryData(['dashboard', 'branch'])).toBeUndefined();
  });

  it('descarta también datos al reemplazar la sesión directamente', () => {
    queryClient.setQueryData(['dashboard'], { revenue: 9000 });
    useSession.getState().setCashSession({ id: 'cash' } as CashSession);
    useSession.getState().setSession({ user: lesly, organization, branch });
    expect(queryClient.getQueryData(['dashboard'])).toBeUndefined();
    expect(useSession.getState().cashSession).toBeNull();
  });

  it('una consulta tardía de Kelly no repuebla el caché de Lesly', async () => {
    let resolve!: (value: unknown) => void;
    const pending = queryClient.fetchQuery({ queryKey: ['dashboard'], queryFn: () =>
      new Promise((done) => { resolve = done; }),
    }).catch(() => undefined);
    useSession.getState().logout();
    useSession.getState().setSession({ user: lesly, organization, branch });
    resolve({ revenue: 9000 });
    await pending;
    expect(queryClient.getQueryData(['dashboard'])).toBeUndefined();
  });

  it('espera la respuesta de logout antes de permitir otro login', async () => {
    let resolve!: () => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<void>((done) => { resolve = done; })));
    useSession.getState().logout();
    const ready = vi.fn();
    const pending = waitForLogout().then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    resolve();
    await pending;
    expect(ready).toHaveBeenCalledOnce();
  });

  it('invalida las sesiones persistidas antes del arreglo', async () => {
    const options = useSession.persist.getOptions();
    expect(options.version).toBe(2);
    expect(await options.migrate?.({ user: kelly, organization, branch }, 0)).toEqual({
      user: null, organization: null, branch: null, cashSession: null,
    });
  });
});
