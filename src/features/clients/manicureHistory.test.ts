import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { manicureHistoryQuery, summarizeManicureHistory, type ManicureServiceRow } from './manicureHistory';

const row = (description: string, extra: Partial<ManicureServiceRow> = {}): ManicureServiceRow => ({
  appointmentId: 'visit', startAt: '2026-10-17T10:00:00', description,
  serviceName: null, category: 'Manicura', staffName: 'Colaboradora', ...extra,
});

describe('detección de sistemas desde servicios realizados', () => {
  it.each([
    ['Manicura - Extension - Poligel - Diseño Elaborado I', ['polygel']],
    ['Retoque Poly-gel', ['polygel']],
    ['Manicura - Acrílico Normal', ['acrylic']],
    ['Manicura - Base Calcio (Japones) - Normal', ['calcium']],
    ['Base de calcio', ['calcium']],
    ['Manicura - Base ruber', ['rubber']],
    ['Base rubber', ['rubber']],
    ['Manicura japonesa', ['japanese']],
    ['Manicura - Esmaltado Normal', ['regular']],
    ['Esmalte tradicional', ['regular']],
    ['Manicura - Esmaltado Semipermanente - Normal', ['semi']],
    ['Manicura - SoftGel (extensiones)', ['softgel']],
  ])('identifica %s sin confundir el diseño Normal con esmaltado normal', (name, systems) => {
    expect(summarizeManicureHistory([row(name)]).visits[0].systems).toEqual(systems);
  });
  it('prioriza la descripción realizada sobre el catálogo que pudo cambiar', () => {
    expect(summarizeManicureHistory([row('Manicura Acrílico', { serviceName: 'Manicura Poligel' })]).visits[0].systems).toEqual(['acrylic']);
  });
  it('usa el servicio elegido para citas importadas con una descripción genérica', () => {
    expect(summarizeManicureHistory([row('Semi clienta del sábado', { serviceName: 'Manicura - Esmaltado Semipermanente - Normal' })]).visits[0].systems).toEqual(['semi']);
    expect(summarizeManicureHistory([row('Uñas', { serviceName: 'Manicura - Base ruber' })]).visits[0].systems).toEqual(['rubber']);
  });
  it('no inventa un sistema en citas genéricas o de limpieza', () => {
    for (const description of ['Manicura (por definir)', 'Manicura - Limpieza', 'Manicura', 'Uñas']) {
      expect(summarizeManicureHistory([row(description)]).visits[0].systems).toEqual([]);
    }
  });
  it('distingue retiro de aplicación, incluso cuando hay ambos en la misma cita', () => {
    const removal = summarizeManicureHistory([row('Manicura - Retiro Acrílico', { serviceName: 'Manicura - Acrilico - Retiro Acrilico' })]);
    expect(removal.visits[0]).toMatchObject({ systems: [], removedSystems: ['acrylic'], hasRemoval: true });
    expect(removal.usual).toEqual([]);
    expect(summarizeManicureHistory([row('Retiro de acrílico + aplicación rubber')]).visits[0]).toMatchObject({ systems: ['rubber'], removedSystems: ['acrylic'] });
  });
  it('ignora pedicura y otras categorías aunque mencionen los mismos productos', () => {
    expect(summarizeManicureHistory([
      row('Pedicura - Esmaltado Normal', { category: 'Pedicura' }),
      row('Tratamiento capilar de calcio', { category: 'Cabello' }),
      row('Pedicura semipermanente', { category: null }),
      row('Masaje japonés', { category: null }),
    ]).visits).toEqual([]);
    expect(summarizeManicureHistory([row('Uñas acrílico', { category: null })]).visits[0].systems).toEqual(['acrylic']);
  });
});

describe('última manicura y sistema habitual', () => {
  it('ordena por fecha de cita y no oculta una visita genérica más reciente', () => {
    const history = summarizeManicureHistory([
      row('Poligel', { appointmentId: 'older', startAt: '2026-09-01T10:00:00' }),
      row('Manicura - Limpieza', { appointmentId: 'latest', startAt: '2026-10-17T10:00:00' }),
    ]);
    expect(history.visits[0]).toMatchObject({ appointmentId: 'latest', systems: [] });
  });
  it('cuenta una vez por cita, aunque existan varias líneas del mismo sistema', () => {
    const history = summarizeManicureHistory([
      row('Manicura Poligel', { appointmentId: 'a' }), row('Extra: extensión Poligel', { appointmentId: 'a' }),
      row('Retoque Poligel', { appointmentId: 'b' }), row('Manicura Rubber', { appointmentId: 'c' }),
      row('Retiro Poligel', { appointmentId: 'd' }),
    ]);
    expect(history.visits).toHaveLength(4);
    expect(history.usual).toEqual([{ system: 'polygel', visits: 2 }]);
  });
  it('separa la base del acabado para calcular el sistema habitual', () => {
    const history = summarizeManicureHistory([row('Base de calcio'), row('Esmaltado semipermanente')]);
    expect(history.visits[0]).toMatchObject({ systems: ['calcium'], finishes: ['semi'] });
  });
  it('muestra los empates y no llama habitual a una sola aplicación', () => {
    expect(summarizeManicureHistory([row('Poligel')]).usual).toEqual([]);
    const history = summarizeManicureHistory([
      row('Poligel', { appointmentId: 'a' }), row('Poligel', { appointmentId: 'b' }),
      row('Rubber', { appointmentId: 'c' }), row('Rubber', { appointmentId: 'd' }),
    ]);
    expect(history.usual).toHaveLength(2);
    expect(history.usual.every((system) => system.visits === 2)).toBe(true);
  });
});

describe('consulta de citas atendidas', () => {
  it('filtra organización, cliente, estado, productos, cantidades y categoría en la base', async () => {
    const db = createClient({ url: 'file::memory:' });
    try {
      await db.execute('CREATE TABLE appointment (id TEXT PRIMARY KEY, organization_id TEXT, customer_id TEXT, start_at TEXT, status TEXT)');
      await db.execute('CREATE TABLE appointment_item (id TEXT, appointment_id TEXT, description TEXT, category TEXT, service_id TEXT, product_id TEXT, quantity INTEGER, assigned_staff_id TEXT)');
      await db.execute('CREATE TABLE service (id TEXT, organization_id TEXT, name TEXT, category TEXT)');
      await db.execute('CREATE TABLE staff_member (id TEXT, organization_id TEXT, first_name TEXT, last_name TEXT)');
      await db.execute("INSERT INTO service VALUES ('rubber', 'org', 'Manicura - Base ruber', 'Manicura')");
      const fixtures = [
        ['ok', 'org', 'client', 'attended', null, 1, 'Manicura'],
        ['confirmed', 'org', 'client', 'confirmed', null, 1, 'Manicura'],
        ['cancelled', 'org', 'client', 'cancelled', null, 1, 'Manicura'],
        ['other-org', 'other', 'client', 'attended', null, 1, 'Manicura'],
        ['other-client', 'org', 'other', 'attended', null, 1, 'Manicura'],
        ['product', 'org', 'client', 'attended', 'product', 1, 'Manicura'],
        ['zero', 'org', 'client', 'attended', null, 0, 'Manicura'],
        ['feet', 'org', 'client', 'attended', null, 1, 'Pedicura'],
      ] as const;
      for (const [id, orgId, customerId, status, product, qty, category] of fixtures) {
        await db.execute({ sql: 'INSERT INTO appointment VALUES (?, ?, ?, ?, ?)', args: [id, orgId, customerId, '2026-10-17T10:00:00', status] });
        await db.execute({ sql: 'INSERT INTO appointment_item VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: [id, id, 'Uñas', category, 'rubber', product, qty, null] });
      }
      const stmt = manicureHistoryQuery('org', 'client');
      const rows = (await db.execute(stmt)).rows as unknown as ManicureServiceRow[];
      expect(rows.map((r) => r.appointmentId)).toEqual(['ok']);
      expect(summarizeManicureHistory(rows).visits[0].systems).toEqual(['rubber']);
    } finally { db.close(); }
  });
});
