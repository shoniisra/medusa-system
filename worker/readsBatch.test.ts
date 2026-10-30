import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';

const { batch, createClient } = vi.hoisted(() => ({
  batch: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('@libsql/client/web', () => ({ createClient }));

const env = {
  TURSO_DATABASE_URL: 'libsql://test',
  TURSO_AUTH_TOKEN: 'token',
  SESSION_SECRET: 'secret',
  GCAL_SYNC_SECRET: '',
  ASSETS: { fetch: () => Promise.resolve(new Response(null, { status: 404 })) },
};

function post(body: unknown): Promise<Response> {
  return worker.fetch(
    new Request('http://localhost/api/db', { method: 'POST', body: JSON.stringify(body) }),
    env,
  );
}

describe('lecturas agrupadas en /api/db', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createClient.mockReturnValue({ batch });
  });

  it('resuelve varias lecturas con un solo batch de lectura', async () => {
    batch.mockResolvedValue([{ rows: [{ n: 1 }] }, { rows: [{ n: 2 }] }]);
    const res = await post({ reads: [{ sql: 'SELECT 1 AS n' }, { sql: 'SELECT ? AS n', args: [2] }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ rows: [{ n: 1 }] }, { rows: [{ n: 2 }] }] });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledWith(
      [{ sql: 'SELECT 1 AS n', args: [] }, { sql: 'SELECT ? AS n', args: [2] }],
      'read',
    );
  });

  it('rechaza escrituras dentro del lote sin tocar la base', async () => {
    const res = await post({ reads: [{ sql: 'SELECT 1' }, { sql: 'DELETE FROM sale' }] });
    expect(res.status).toBe(400);
    expect(batch).not.toHaveBeenCalled();
  });

  it('rechaza lotes vacíos', async () => {
    const res = await post({ reads: [] });
    expect(res.status).toBe(400);
  });
});
