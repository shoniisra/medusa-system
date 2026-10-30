import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('agrupado de lecturas', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const sentBodies = () =>
    fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as Record<string, unknown>);

  it('junta las lecturas simultáneas en un solo request', async () => {
    fetchMock.mockImplementation(() => json({ results: [{ rows: [{ a: 1 }] }, { rows: [{ b: 2 }] }] }));
    const { query } = await import('./db');
    const [a, b] = await Promise.all([query('SELECT 1 AS a'), query('SELECT ? AS b', [2])]);
    expect(a).toEqual([{ a: 1 }]);
    expect(b).toEqual([{ b: 2 }]);
    expect(sentBodies()).toEqual([
      { reads: [{ sql: 'SELECT 1 AS a', args: [] }, { sql: 'SELECT ? AS b', args: [2] }] },
    ]);
  });

  it('una lectura sola viaja como antes', async () => {
    fetchMock.mockImplementation(() => json({ rows: [{ a: 1 }] }));
    const { query } = await import('./db');
    expect(await query('SELECT 1 AS a')).toEqual([{ a: 1 }]);
    expect(sentBodies()).toEqual([{ sql: 'SELECT 1 AS a', args: [] }]);
  });

  it('si el lote falla, reintenta cada lectura y aísla el error', async () => {
    fetchMock.mockImplementation((_url, init) => {
      const body = JSON.parse(init?.body as string) as { reads?: unknown; sql?: string };
      if (body.reads) return json({ error: 'no such table: x' }, 400);
      return body.sql === 'SELECT * FROM x' ? json({ error: 'no such table: x' }, 400) : json({ rows: [{ ok: 1 }] });
    });
    const { query } = await import('./db');
    const [good, bad] = await Promise.allSettled([query('SELECT 1 AS ok'), query('SELECT * FROM x')]);
    expect(good).toEqual({ status: 'fulfilled', value: [{ ok: 1 }] });
    expect(bad).toMatchObject({ status: 'rejected', reason: new Error('no such table: x') });
  });

  it('las escrituras no se agrupan', async () => {
    fetchMock.mockImplementation(() => json({ rowsAffected: 1 }));
    const { execute } = await import('./db');
    expect(await execute('UPDATE sale SET total = ? WHERE id = ?', [1, 'a'])).toBe(1);
    expect(sentBodies()).toEqual([{ sql: 'UPDATE sale SET total = ? WHERE id = ?', args: [1, 'a'] }]);
  });
});
