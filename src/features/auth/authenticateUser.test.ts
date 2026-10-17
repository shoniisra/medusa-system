import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateUser } from './authenticateUser';
import { queryOne } from '@/lib/db';
import { waitForLogout } from '@/store/session';

vi.mock('@/lib/db', () => ({ queryOne: vi.fn() }));
vi.mock('@/store/session', () => ({ waitForLogout: vi.fn() }));

const user = { id: 'user_leslie', organization_id: 'org', role: 'staff', active: 1 };
describe('identidad y rol verificados en login', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('en desarrollo también autentica con el servidor para obtener la cookie de auditoría', async () => {
    vi.stubEnv('DEV', true);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ user }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await authenticateUser('user_leslie', 'org', 'branch', '1234');
    expect(result.role).toBe('staff');
    expect(fetchMock).toHaveBeenCalledWith('/api/login', expect.objectContaining({ credentials: 'include' }));
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('en producción toma el rol del usuario devuelto por el servidor', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ user })));
    expect((await authenticateUser('user_leslie', 'org', 'branch', '1234')).role).toBe('staff');
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('rechaza una respuesta que corresponde a Kelly al entrar como Lesly', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ user: { ...user, id: 'user_kelly', role: 'manager' } })));
    await expect(authenticateUser('user_leslie', 'org', 'branch', '1234')).rejects.toThrow('no coincide');
  });

  it('no inicia autenticación hasta completar el logout anterior', async () => {
    vi.stubEnv('DEV', false);
    let resolve!: () => void;
    vi.mocked(waitForLogout).mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ user }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = authenticateUser('user_leslie', 'org', 'branch', '1234');
    expect(fetchMock).not.toHaveBeenCalled();
    resolve();
    await pending;
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
