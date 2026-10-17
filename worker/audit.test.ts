import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { createClient as createWebClient } from '@libsql/client/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditedBatch, readAudit, validateAppStatement, withSystemAudit, type AuditActor } from './audit';
import { requireActor, sessionSigningSecret } from './session';
import { hashPassword, signToken } from './auth';
import worker from './index';
import schema from './audit-schema.fixture.json';

vi.mock('@libsql/client/web', () => ({ createClient: vi.fn() }));
const migration = readFileSync(new URL('../docs/migrations/2026-10-17-audit-log.sql', import.meta.url), 'utf8');
const actor: AuditActor = { id: 'lesly', name: 'Lesly', role: 'staff', orgId: 'org', source: 'app' };
const env = { TURSO_DATABASE_URL: 'libsql://unused', TURSO_AUTH_TOKEN: 'server-secret', SESSION_SECRET: '', GCAL_SYNC_SECRET: '', ASSETS: { fetch: () => Promise.resolve(new Response(null, { status: 404 })) } };
let directory: string;
let db: Client;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'medusa-audit-'));
  db = createClient({ url: `file:${join(directory, 'db.sqlite')}` });
  await db.execute('PRAGMA foreign_keys=ON');
  vi.mocked(createWebClient).mockReturnValue(db);
  for (const [table, columns] of Object.entries(schema)) {
    const parent = table === 'appointment_item' ? ', FOREIGN KEY(appointment_id) REFERENCES appointment(id) ON DELETE CASCADE' : '';
    await db.execute(`CREATE TABLE ${table} (${columns.map((c) => `"${c}"${c === 'id' ? ' TEXT PRIMARY KEY' : ''}`).join(', ')}${parent})`);
  }
  await db.execute('CREATE TABLE branch (id TEXT PRIMARY KEY, organization_id TEXT)');
  await db.execute('CREATE TABLE cash_register (id TEXT PRIMARY KEY, branch_id TEXT)');
  await db.execute('CREATE TABLE app_user (id TEXT PRIMARY KEY, organization_id TEXT, full_name TEXT, role TEXT, active INTEGER, password_hash TEXT, username TEXT, email TEXT, phone TEXT, last_login_at TEXT, created_at TEXT, updated_at TEXT)');
  await db.execute("INSERT INTO branch VALUES ('branch', 'org')");
  await db.execute("INSERT INTO cash_register VALUES ('register', 'branch')");
  await db.execute("INSERT INTO app_user (id, organization_id, full_name, role, active) VALUES ('lesly','org','Lesly','staff',1), ('kelly','org','Kelly','manager',1)");
  // La base del salón ya tenía esta tabla e índice de una implementación anterior.
  await db.execute('CREATE TABLE audit_log (id TEXT PRIMARY KEY,user_id TEXT,entity_name TEXT,entity_id TEXT,created_at TEXT)');
  await db.execute('CREATE INDEX idx_audit_entity ON audit_log(entity_name,entity_id,created_at)');
  await db.execute("INSERT INTO audit_log VALUES ('legacy','user','customer','old','2026-01-01')");
  for (const statement of migration.split('-- statement-breakpoint')) await db.execute(statement);
});
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

async function cookie(userId = 'lesly', role = 'staff') {
  return `medusa_session=${await signToken({ userId, role, orgId: 'org', branchId: 'branch' }, sessionSigningSecret(env))}`;
}

describe('historial transaccional por fila', () => {
  it('conserva la auditoría antigua y permite reaplicar la migración sin perder eventos', async () => {
    await auditedBatch(db, ["INSERT INTO customer (id,organization_id) VALUES ('client','org')"], actor);
    await db.batch(migration.split('-- statement-breakpoint').map((sql) => ({ sql, args: [] })), 'write');
    expect((await db.execute('SELECT * FROM audit_log')).rows[0].id).toBe('legacy');
    expect((await db.execute('SELECT * FROM app_audit_log')).rows).toHaveLength(1);
  });
  it('audita creación, cambios y eliminación en las 17 tablas, con valores antes/después', async () => {
    // Los padres se crean primero para resolver la organización de los detalles.
    for (const table of Object.keys(schema)) {
      const columns = ['id', ...['organization_id','branch_id','appointment_id','sale_id','sale_item_id','customer_id','cash_register_id'].filter((c) => schema[table as keyof typeof schema].includes(c))];
      const args = columns.map((column) => column === 'id' ? table : ({ organization_id: 'org', branch_id: 'branch', appointment_id: 'appointment', sale_id: 'sale', sale_item_id: 'sale_item', customer_id: 'customer', cash_register_id: 'register' }[column] ?? ''));
      await auditedBatch(db, [{ sql: `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, args }], actor);
      await auditedBatch(db, [{ sql: `UPDATE ${table} SET id = ? WHERE id = ?`, args: [`${table}-changed`, table] }], actor);
      // Restaurar id del padre para los detalles siguientes (también queda auditado).
      await auditedBatch(db, [{ sql: `UPDATE ${table} SET id = ? WHERE id = ?`, args: [table, `${table}-changed`] }], actor);
    }
    const created = (await db.execute("SELECT * FROM app_audit_log WHERE action='create'")).rows;
    expect(created).toHaveLength(17);
    expect(created.every((r) => r.actor_id === 'lesly' && r.actor_name === 'Lesly' && r.organization_id === 'org')).toBe(true);
    const change = (await db.execute("SELECT * FROM app_audit_log WHERE table_name='customer' AND action='update' ORDER BY id LIMIT 1")).rows[0];
    expect(JSON.parse(change.before_data as string)).toMatchObject({ id: 'customer' });
    expect(JSON.parse(change.after_data as string)).toMatchObject({ id: 'customer-changed' });
    for (const table of Object.keys(schema).reverse()) await auditedBatch(db, [{ sql: `DELETE FROM ${table} WHERE id = ?`, args: [table] }], actor);
    expect((await db.execute("SELECT * FROM app_audit_log WHERE action='delete'")).rows).toHaveLength(17);
    expect((await db.execute('SELECT * FROM app_audit_context')).rows).toHaveLength(0);
  });

  it('revierte el cambio y su auditoría si falla cualquier sentencia del lote', async () => {
    await expect(auditedBatch(db, ["INSERT INTO customer (id,organization_id) VALUES ('new','org')", 'INSERT INTO nonexistent VALUES (1)'], actor)).rejects.toThrow();
    expect((await db.execute('SELECT * FROM customer')).rows).toHaveLength(0);
    expect((await db.execute('SELECT * FROM app_audit_log')).rows).toHaveLength(0);
    expect((await db.execute('SELECT * FROM app_audit_context')).rows).toHaveLength(0);
  });

  it('no mezcla actores entre operaciones y no inventa autor para escrituras externas', async () => {
    await auditedBatch(db, ["INSERT INTO customer (id,organization_id) VALUES ('client','org')"], actor);
    await auditedBatch(db, ["UPDATE customer SET first_name='Cambio de Kelly' WHERE id='client'"], { ...actor, id: 'kelly', name: 'Kelly', role: 'manager' });
    await db.execute("UPDATE customer SET first_name='Cambio externo' WHERE id='client'");
    const rows = (await db.execute('SELECT * FROM app_audit_log ORDER BY id')).rows;
    expect(rows.map((r) => r.actor_id)).toEqual(['lesly','kelly',null]);
    expect(rows[2].source).toBe('external');
  });

  it('identifica los cambios de Google Calendar', async () => {
    await withSystemAudit(db).execute("INSERT INTO appointment (id, organization_id) VALUES ('google','org')");
    expect((await db.execute('SELECT * FROM app_audit_log')).rows[0]).toMatchObject({ actor_name: 'Google Calendar', actor_id: null, source: 'google-calendar' });
  });

  it('no crea eventos cuando el UPDATE no cambia nada ni cuando afecta cero filas', async () => {
    await auditedBatch(db, ["INSERT INTO customer (id,organization_id) VALUES ('client','org')"], actor);
    await auditedBatch(db, ["UPDATE customer SET id=id WHERE id='client'", "DELETE FROM customer WHERE id='missing'"], actor);
    expect((await db.execute('SELECT * FROM app_audit_log')).rows).toHaveLength(1);
  });

  it('el historial permanece al borrar el cliente y rechaza editar o borrar sus eventos', async () => {
    await auditedBatch(db, ["INSERT INTO customer (id,organization_id) VALUES ('client','org')", "DELETE FROM customer WHERE id='client'"], actor);
    await expect(db.execute('DELETE FROM app_audit_log')).rejects.toThrow('no se puede eliminar');
    await expect(db.execute("UPDATE app_audit_log SET actor_name='Otro'")).rejects.toThrow('no se puede editar');
    expect((await db.execute('SELECT * FROM app_audit_log')).rows).toHaveLength(2);
  });

  it('registra eliminaciones en cascada bajo el autor de la operación', async () => {
    await auditedBatch(db, [
      "INSERT INTO appointment (id,organization_id,branch_id) VALUES ('a','org','branch')",
      "INSERT INTO appointment_item (id,appointment_id,description) VALUES ('item','a','Manicura')",
      "DELETE FROM appointment WHERE id='a'",
    ], actor);
    const events = (await db.execute("SELECT * FROM app_audit_log WHERE action='delete'")).rows;
    expect(events).toHaveLength(2);
    expect(events.every((row) => row.actor_id === 'lesly' && row.organization_id === 'org')).toBe(true);
    expect((await db.execute('SELECT * FROM appointment_item')).rows).toHaveLength(0);
  });

  it('mantiene separados dos lotes solicitados a la vez', async () => {
    await Promise.all([
      auditedBatch(db, ["INSERT INTO customer (id,organization_id) VALUES ('a','org')"], actor),
      auditedBatch(db, ["INSERT INTO customer (id,organization_id) VALUES ('b','org')"], { ...actor, id: 'kelly', name: 'Kelly' }),
    ]);
    const rows = (await db.execute('SELECT record_id,actor_id FROM app_audit_log ORDER BY record_id')).rows;
    expect(rows).toMatchObject([{ record_id: 'a', actor_id: 'lesly' }, { record_id: 'b', actor_id: 'kelly' }]);
  });
});

describe('identidad y acceso a la auditoría', () => {
  it('login exige credencial y emite cookie firmada incluso sin SESSION_SECRET explícito', async () => {
    // Completar solo las columnas usadas por el handler de login.
    await db.execute('ALTER TABLE branch ADD COLUMN name TEXT');
    await db.execute('ALTER TABLE branch ADD COLUMN code TEXT');
    await db.execute('ALTER TABLE branch ADD COLUMN active INTEGER DEFAULT 1');
    await db.execute('CREATE TABLE organization (id TEXT PRIMARY KEY,name TEXT,active INTEGER)');
    await db.execute("INSERT INTO organization VALUES ('org','Medusa',1)");
    const login = () => worker.fetch(new Request('http://localhost/api/login', { method: 'POST', body: JSON.stringify({ user_id: 'lesly', org_id: 'org', branch_id: 'branch', password: '1234' }) }), env);
    expect((await login()).status).toBe(401);
    await db.execute({ sql: "UPDATE app_user SET password_hash=? WHERE id='lesly'", args: [await hashPassword('1234')] });
    const response = await login();
    expect(response.status).toBe(200);
    const value = response.headers.get('set-cookie')!;
    expect(value).toContain('HttpOnly');
    expect(await requireActor(new Request('http://localhost', { headers: { cookie: value.split(';')[0] } }), env, db)).toMatchObject({ id: 'lesly' });
  });
  it('requiere cookie válida y consulta el rol vigente, sin aceptar identidad del cliente', async () => {
    await expect(requireActor(new Request('http://localhost'), env, db)).rejects.toMatchObject({ status: 401 });
    const request = new Request('http://localhost', { headers: { cookie: await cookie() } });
    expect(await requireActor(request, env, db)).toMatchObject({ id: 'lesly', role: 'staff' });
    await db.execute("UPDATE app_user SET active=0 WHERE id='lesly'");
    await expect(requireActor(request, env, db)).rejects.toMatchObject({ status: 401 });
  });

  it.each(['staff','cashier'])('rechaza lectura para %s en el servidor', async (role) => {
    await expect(readAudit(new URL('http://localhost/api/audit'), { id: 'lesly', organization_id: 'org', role, full_name: 'Lesly' }, db)).rejects.toMatchObject({ status: 403 });
  });

  it.each(['admin','manager'])('permite %s, filtra organización y pagina sin repetir eventos', async (role) => {
    await auditedBatch(db, Array.from({ length: 52 }, (_, i) => ({ sql: 'INSERT INTO customer (id,organization_id) VALUES (?,?)', args: [`c${i}`, i === 0 ? 'other-org' : 'org'] })), actor);
    const manager = { id: 'kelly', organization_id: 'org', role, full_name: 'Kelly' };
    const first = await (await readAudit(new URL('http://localhost/api/audit?organization_id=other-org'), manager, db)).json() as { rows: { id: number; organization_id: string }[]; next: number };
    expect(first.rows).toHaveLength(50);
    expect(first.rows.every((r) => r.organization_id === 'org')).toBe(true);
    const next = await (await readAudit(new URL(`http://localhost/api/audit?before=${first.next}`), manager, db)).json() as { rows: { id: number }[]; next: null };
    expect(next.rows).toHaveLength(1);
    expect(first.rows.some((r) => r.id === next.rows[0].id)).toBe(false);
    expect(next.next).toBeNull();
  });

  it('el proxy audita escrituras, bloquea escritura anónima y no deja saltarse el endpoint', async () => {
    const send = (body: unknown, value = '') => worker.fetch(new Request('http://localhost/api/db', { method: 'POST', headers: { cookie: value }, body: JSON.stringify(body) }), env);
    expect((await send({ sql: "INSERT INTO customer (id) VALUES ('anonymous')" })).status).toBe(401);
    expect((await send({ sql: "UPDATE app_user SET role='manager' WHERE id='lesly'" }, await cookie())).status).toBe(403);
    const response = await send({ sql: "INSERT INTO customer (id,organization_id) VALUES ('from-app','org')", actor_id: 'kelly' }, await cookie());
    expect(response.status).toBe(200);
    expect((await db.execute('SELECT * FROM app_audit_log')).rows[0].actor_id).toBe('lesly');
    expect((await send({ sql: 'SELECT * FROM app_audit_log' }, await cookie())).status).toBe(403);
    const history = await worker.fetch(new Request('http://localhost/api/audit', { headers: { cookie: await cookie('kelly','manager') } }), env);
    expect(history.status).toBe(200);
    expect(history.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['DROP TRIGGER audit_customer_update', 'PRAGMA writable_schema=1', 'UPDATE app_audit_context SET actor_id=?', 'SELECT * FROM "app_audit_log"', 'SELECT 1; DELETE FROM customer', 'INSERT OR REPLACE INTO customer (id) VALUES (?)'])('bloquea SQL que evade auditoría: %s', (sql) => {
    expect(() => validateAppStatement(sql)).toThrow();
  });
});
