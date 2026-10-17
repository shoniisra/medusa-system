import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connect, ViteDevServer } from 'vite';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { devApi } from './devApi';
import { verifyPassword } from './auth';

const { execute, createClient } = vi.hoisted(() => ({
  execute: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('@libsql/client/web', () => ({ createClient }));

describe('API de contraseñas en el servidor local', () => {
  let middleware: Connect.NextHandleFunction;

  beforeEach(() => {
    vi.resetAllMocks();
    const register = vi.fn<(handler: Connect.NextHandleFunction) => void>();
    const plugin = devApi({
      VITE_TURSO_DATABASE_URL: 'libsql://dev.example.com',
      VITE_TURSO_AUTH_TOKEN: 'dev-token',
      SESSION_SECRET: 'production-secret-must-not-affect-local-login',
    });
    if (typeof plugin.configureServer !== 'function') throw new Error('Falta configureServer');
    void plugin.configureServer({ middlewares: { use: register } } as unknown as ViteDevServer);
    middleware = register.mock.calls[0][0];
    createClient.mockReturnValue({ execute });
    execute.mockResolvedValue({ rowsAffected: 1 });
  });

  function request(path: string, body: string): Promise<Response> {
    return new Promise((resolve, reject) => {
      const req = new IncomingMessage(new Socket());
      req.method = 'POST';
      req.url = path;
      req.headers = { 'content-type': 'application/json' };
      const res = new ServerResponse(req);
      vi.spyOn(res, 'end').mockImplementation((chunk?: unknown) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.getHeaders())) {
          if (value !== undefined) headers.set(key, String(value));
        }
        const body = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : '';
        resolve(new Response(body, { status: res.statusCode, headers }));
        return res;
      });
      middleware(req, res, (error?: unknown) => {
        if (error) reject(error instanceof Error ? error : new Error('Error del middleware'));
        else resolve(new Response(null, { status: 404 }));
      });
      req.push(body);
      req.push(null);
    });
  }

  function post(body: unknown) {
    return request('/api/set-password', JSON.stringify(body));
  }

  it('guarda un hash compatible con el login local y limita el cambio a la organización', async () => {
    const response = await post({ user_id: 'user-1', org_id: 'org-1', password: '7391' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(createClient).toHaveBeenCalledWith({
      url: 'libsql://dev.example.com', authToken: 'dev-token', intMode: 'number',
    });
    expect(execute).toHaveBeenCalledWith({
      sql: expect.stringContaining('WHERE id = ? AND organization_id = ?'),
      args: [expect.any(String), expect.any(String), 'user-1', 'org-1'],
    });
    const statement = execute.mock.calls[0][0] as { args: string[] };
    expect(statement.args[0]).not.toBe('7391');
    expect(await verifyPassword('7391', statement.args[0])).toBe(true);
    expect(await verifyPassword('0000', statement.args[0])).toBe(false);
  });

  it.each([
    { user_id: 'user-1', org_id: 'org-1', password: '123' },
    { user_id: 'user-1', password: '7391' },
  ])('rechaza datos incompletos sin modificar la base: %j', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('devuelve errores de la base como JSON', async () => {
    execute.mockRejectedValue(new Error('Base no disponible'));
    const response = await post({ user_id: 'user-1', org_id: 'org-1', password: '7391' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Base no disponible' });
  });

  it('conserva la ruta de Calendar', async () => {
    const response = await request('/api/gcal', '{}');
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('no intercepta rutas ajenas', async () => {
    expect((await request('/api/set-password-extra', '{}')).status).toBe(404);
    expect(execute).not.toHaveBeenCalled();
  });
});
