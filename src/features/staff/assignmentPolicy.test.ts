import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASSIGNABLE_STAFF_SQL, AVAILABLE_CATEGORY_SERVICE_SQL } from './assignmentPolicy';

let db: Client;
beforeEach(async () => {
  db = createClient({ url: 'file::memory:' });
  await db.executeMultiple(`
    CREATE TABLE staff_member (id TEXT PRIMARY KEY, organization_id TEXT, first_name TEXT, active INTEGER);
    CREATE TABLE staff_category (staff_member_id TEXT, category TEXT, active INTEGER);
    CREATE TABLE service (id TEXT PRIMARY KEY, organization_id TEXT, category TEXT, active INTEGER);
    CREATE TABLE staff_service_exclusion (staff_member_id TEXT, service_id TEXT, active INTEGER);
    CREATE TABLE app_user (id TEXT PRIMARY KEY, role TEXT, active INTEGER);
    INSERT INTO staff_member VALUES ('johnny','org','Johnny',1), ('gis','org','Gis',1), ('admin-stylist','org','Admin estilista',1), ('other','other-org','Otro',1);
    INSERT INTO staff_category VALUES ('gis','Uñas',1), ('admin-stylist','Uñas',1), ('other','Uñas',1);
    INSERT INTO service VALUES ('nails','org','Uñas',1), ('other-nails','other-org','Uñas',1);
    INSERT INTO staff_service_exclusion VALUES ('johnny','nails',1);
    INSERT INTO app_user VALUES ('johnny','admin',1), ('admin-stylist','admin',1);
  `);
});
afterEach(() => db.close());

async function assignableIds() {
  return (await db.execute({ sql: ASSIGNABLE_STAFF_SQL, args: ['org'] })).rows.map(row => row.id);
}

describe('personal asignable a servicios', () => {
  it('oculta a Johnny sin especialidades y mantiene su cuenta de administrador', async () => {
    expect(await assignableIds()).toEqual(['admin-stylist', 'gis']);
    const user = (await db.execute("SELECT role, active FROM app_user WHERE id = 'johnny'")).rows[0];
    expect(user).toMatchObject({ role: 'admin', active: 1 });
  });
  it('excluye a quien tiene todos sus servicios excluidos aunque tenga una especialidad', async () => {
    await db.execute("INSERT INTO staff_category VALUES ('johnny','Uñas',1)");
    expect(await assignableIds()).not.toContain('johnny');
    const candidates = await db.execute({
      sql: `SELECT sm.id FROM staff_category sc JOIN staff_member sm ON sm.id = sc.staff_member_id WHERE sm.organization_id = ? AND sc.active = 1 AND sm.active = 1 AND ${AVAILABLE_CATEGORY_SERVICE_SQL}`,
      args: ['org'],
    });
    expect(candidates.rows.map(row => row.id)).not.toContain('johnny');
  });
  it('respeta servicios, especialidades y exclusiones activas', async () => {
    await db.execute("INSERT INTO staff_service_exclusion VALUES ('gis','nails',1)");
    expect(await assignableIds()).not.toContain('gis');
    await db.execute("UPDATE staff_service_exclusion SET active = 0 WHERE staff_member_id = 'gis'");
    expect(await assignableIds()).toContain('gis');
    await db.execute("UPDATE staff_category SET active = 0 WHERE staff_member_id = 'gis'");
    expect(await assignableIds()).not.toContain('gis');
    await db.execute("UPDATE service SET active = 0 WHERE organization_id = 'org'");
    expect(await assignableIds()).toEqual([]);
  });
});
