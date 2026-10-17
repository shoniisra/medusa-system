import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commissionBalance, COMMISSION_BALANCE_SQL, type CommissionBalanceData } from './commissionBalanceModel';

let db: Client;
beforeEach(async () => {
  db = createClient({ url: 'file::memory:' });
  await db.executeMultiple(`
    CREATE TABLE staff_member (id TEXT, organization_id TEXT, first_name TEXT, last_name TEXT, color TEXT, active INTEGER);
    CREATE TABLE sale (id TEXT, branch_id TEXT, sold_at TEXT, status TEXT);
    CREATE TABLE sale_item (id TEXT, sale_id TEXT);
    CREATE TABLE sale_service_staff (sale_item_id TEXT, staff_member_id TEXT, commission_amount REAL);
    CREATE TABLE staff_advance (staff_member_id TEXT, branch_id TEXT, advance_date TEXT, amount REAL, notes TEXT, status TEXT);
    CREATE TABLE staff_payment (staff_member_id TEXT, branch_id TEXT, paid_at TEXT, net_paid REAL, status TEXT);
    INSERT INTO staff_member VALUES ('staff','org','Gis',NULL,NULL,1);
  `);
});
afterEach(() => db.close());

async function earned(id: string, time: string, amount: number, status = 'completed', branch = 'branch') {
  await db.batch([
    { sql: 'INSERT INTO sale VALUES (?,?,?,?)', args: [id, branch, time, status] },
    { sql: 'INSERT INTO sale_item VALUES (?,?)', args: [id, id] },
    { sql: 'INSERT INTO sale_service_staff VALUES (?,?,?)', args: [id, 'staff', amount] },
  ], 'write');
}
async function advance(date: string, amount: number, notes: string | null = null, status = 'confirmed') {
  await db.execute({ sql: 'INSERT INTO staff_advance VALUES (?,?,?,?,?,?)', args: ['staff','branch',date,amount,notes,status] });
}
async function pay(date: string, amount: number, status = 'confirmed') {
  await db.execute({ sql: 'INSERT INTO staff_payment VALUES (?,?,?,?,?)', args: ['staff','branch',date,amount,status] });
}
async function balance(start = '2026-10-12T05:00:00Z', monday = '2026-10-12', today = '2026-10-17', now = '2026-10-17T22:00:00Z') {
  const result = await db.execute({ sql: COMMISSION_BALANCE_SQL, args: ['org','branch',start,monday,today,now] });
  return commissionBalance(result.rows[0] as unknown as CommissionBalanceData);
}

describe('saldos con resumen semanal', () => {
  it('conserva pendientes anteriores y muestra solo adelantos y pagos de esta semana', async () => {
    await earned('previous','2026-10-08T15:00:00Z',100);
    await advance('2026-10-09',25);
    await pay('2026-10-10T15:00:00Z',50);
    await earned('current','2026-10-14T15:00:00Z',80);
    await advance('2026-10-15',20);
    await pay('2026-10-16T15:00:00Z',30);
    expect(await balance()).toMatchObject({ opening: 25, earned_week: 80, advances_week: 20, paid_week: 30, pending: 55 });
  });
  it('al cambiar de semana reinicia el resumen sin borrar ni descontar dos veces un adelanto', async () => {
    await earned('service','2026-10-14T15:00:00Z',100);
    await advance('2026-10-15',25);
    await pay('2026-10-16T15:00:00Z',75);
    expect(await balance()).toMatchObject({ earned_week: 100, advances_week: 25, paid_week: 75, pending: 0 });
    expect(await balance('2026-10-19T05:00:00Z','2026-10-19','2026-10-19','2026-10-19T15:00:00Z')).toMatchObject({ opening: 0, earned_week: 0, advances_week: 0, paid_week: 0, pending: 0, advances: 25 });
    expect((await db.execute('SELECT COUNT(*) AS count FROM staff_advance')).rows[0].count).toBe(1);
  });
  it('identifica cuadres por separado y mantiene la suma verificable', async () => {
    await earned('old','2026-10-08T15:00:00Z',100);
    await advance('2026-10-09',20,'[Ajuste de comisión]');
    await advance('2026-10-14',10,'[Ajuste de comisión]');
    await advance('2026-10-15',15);
    const row = await balance();
    expect(row).toMatchObject({ opening: 80, earned_week: 0, advances_week: 15, adjustments_week: 10, pending: 55 });
    expect(row.opening + row.earned_week - row.advances_week - row.paid_week - row.adjustments_week).toBe(row.pending);
  });
  it('respeta el lunes local y descarta movimientos futuros, anulados o de otra sucursal', async () => {
    await earned('sunday','2026-10-12T04:59:00Z',10);
    await earned('monday','2026-10-12T05:00:00Z',20);
    await earned('future','2026-10-18T15:00:00Z',999);
    await earned('void','2026-10-15T15:00:00Z',999,'voided');
    await earned('other','2026-10-15T15:00:00Z',999,'completed','other');
    await advance('2026-10-18',999);
    await advance('2026-10-14',999,null,'voided');
    await advance('2026-10-12T04:59:00Z',2);
    await advance('2026-10-12',3);
    await pay('2026-10-12T04:59:00Z',1);
    await pay('2026-10-12T05:00:00Z',4);
    await pay('2026-10-19T15:00:00Z',999);
    expect(await balance()).toMatchObject({ opening: 7, earned_week: 20, advances_week: 3, paid_week: 4, pending: 20 });
  });
});
