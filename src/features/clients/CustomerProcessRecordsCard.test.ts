import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProcessStatement } from './CustomerProcessRecordsCard';

const db = createClient({ url: 'file::memory:' });
const migration = readFileSync(new URL('../../../docs/migrations/2026-10-17-customer-manicure-record.sql', import.meta.url), 'utf8');
const statements = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((sql) => sql.trim()).filter(Boolean);
const base = { id: 'process', orgId: 'org', customerId: 'client', date: '2026-10-17', staffId: 'staff', userId: 'user' };

beforeAll(async () => {
  await db.execute('PRAGMA foreign_keys = ON');
  for (const table of ['organization', 'customer', 'staff_member', 'app_user']) {
    await db.execute(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
  }
  for (const [table, id] of [['organization', 'org'], ['customer', 'client'], ['staff_member', 'staff'], ['app_user', 'user']]) {
    await db.execute({ sql: `INSERT INTO ${table} VALUES (?)`, args: [id] });
  }
  for (const sql of statements) await db.execute(sql);
  await db.execute(`CREATE TABLE customer_color_record (
    id TEXT PRIMARY KEY, organization_id TEXT, customer_id TEXT, record_date TEXT,
    formula TEXT, brand TEXT, developer TEXT, result TEXT, notes TEXT, staff_member_id TEXT, created_by TEXT
  )`);
});
afterAll(() => db.close());

describe('procesos técnicos de clientes', () => {
  it('aplica la migración de manicura repetidamente sin perder datos', async () => {
    const stmt = createProcessStatement('manicure', { ...base, draft: { technique: 'Semipermanente', products: 'Base sensible', shade: 'Rosa 12', notes: 'No limar en exceso' } });
    await db.execute(stmt);
    for (const sql of statements) await db.execute(sql);
    const row = (await db.execute('SELECT * FROM customer_manicure_record')).rows[0];
    expect(row).toMatchObject({ technique: 'Semipermanente', products: 'Base sensible', shade: 'Rosa 12', notes: 'No limar en exceso', customer_id: 'client', organization_id: 'org', staff_member_id: 'staff', created_by: 'user' });
    expect(row.created_at).toBeTruthy();
  });
  it('conserva los campos del proceso de color y parametriza texto libre', async () => {
    const formula = "6.1 + 30 g'; DROP TABLE customer; --";
    const stmt = createProcessStatement('color', { ...base, id: 'color', draft: { formula, developer: '10 vol', result: 'Solo raíz' } });
    expect(stmt.sql).not.toContain(formula);
    await db.execute(stmt);
    expect((await db.execute('SELECT * FROM customer_color_record')).rows[0]).toMatchObject({ formula, developer: '10 vol', result: 'Solo raíz' });
    expect((await db.execute('SELECT id FROM customer')).rows[0].id).toBe('client');
  });
  it('rechaza procesos vacíos, fechas inválidas y clientes ausentes', () => {
    expect(() => createProcessStatement('manicure', { ...base, draft: { notes: '  ' } })).toThrow('al menos');
    expect(() => createProcessStatement('manicure', { ...base, date: '2026-02-31', draft: { technique: 'Gel' } })).toThrow('fecha válida');
    expect(() => createProcessStatement('color', { ...base, customerId: '', draft: { formula: '6.1' } })).toThrow('Elegí un cliente');
  });
  it('impide insertar registros técnicos vacíos incluso directamente en la tabla', async () => {
    await expect(db.execute({ sql: 'INSERT INTO customer_manicure_record (id, organization_id, customer_id, record_date) VALUES (?, ?, ?, ?)', args: ['empty', 'org', 'client', base.date] })).rejects.toThrow();
  });
  it('conserva el proceso al eliminar al miembro del equipo y limpia al eliminar el cliente', async () => {
    await db.execute("DELETE FROM staff_member WHERE id = 'staff'");
    expect((await db.execute("SELECT staff_member_id FROM customer_manicure_record WHERE id = 'process'")).rows[0].staff_member_id).toBeNull();
    await db.execute("DELETE FROM customer WHERE id = 'client'");
    expect((await db.execute('SELECT * FROM customer_manicure_record')).rows).toHaveLength(0);
  });
});
