import { describe, expect, it } from 'vitest';
import { activityTotals, groupingForPeriod, groupActivity, periodBounds, timestampBounds, type ActivityRow } from './activityModel';

const row = (overrides: Partial<ActivityRow> = {}): ActivityRow => ({
  staff_id: 'staff', service: 'Manicura', client: 'Ana', amount: 25, commission: 10,
  role: 'primary', assist_label: null, sold_at: '2026-10-17T15:00:00Z',
  sale_id: 'sale-1', sale_number: 'V001', appointment_id: 'appointment-1', ...overrides,
});

describe('períodos de actividad', () => {
  it('resuelve semanas de lunes a domingo incluso entre años', () => {
    expect(periodBounds('week', '2027-01-03')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });
  it('resuelve meses completos y rechaza fechas inválidas', () => {
    expect(periodBounds('month', '2028-02-18')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodBounds('day', '')).toBeNull();
  });
  it('incluye la noche local y excluye el inicio del día siguiente', () => {
    const bounds = timestampBounds('2026-10-17', '2026-10-17');
    expect(new Date(bounds.start)).toEqual(new Date(2026, 9, 17));
    expect(new Date(bounds.end)).toEqual(new Date(2026, 9, 18));
    expect(new Date(2026, 9, 17, 23, 59).getTime()).toBeLessThan(new Date(bounds.end).getTime());
  });
});

describe('agrupación de servicios', () => {
  it('elige automáticamente cita, día o semana según el período', () => {
    expect(groupingForPeriod('day')).toBe('appointment');
    expect(groupingForPeriod('week')).toBe('day');
    expect(groupingForPeriod('month')).toBe('week');
  });
  it('agrupa una cita con varias ventas y mantiene separadas ventas sin cita', () => {
    const groups = groupActivity([row(), row({ sale_id: 'sale-2' }), row({ appointment_id: null, sale_id: 'walk-in-1' }), row({ appointment_id: null, sale_id: 'walk-in-2' })], 'appointment');
    expect(groups).toHaveLength(3);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].billed).toBe(50);
  });
  it('agrupar por día y semana conserva todos los servicios y subtotales', () => {
    const items = [row(), row({ sold_at: '2026-10-18T15:00:00Z', role: 'assistant', commission: 3 })];
    expect(groupActivity(items, 'day')).toHaveLength(2);
    const weeks = groupActivity(items, 'week');
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ billed: 25, commission: 13 });
    expect(activityTotals(items)).toEqual({ billed: 25, commission: 13 });
  });
  it('separa semanas de lunes a domingo y conserva los totales al cruzar de mes', () => {
    const items = [row({ sold_at: '2026-10-01T15:00:00Z' }), row({ sold_at: '2026-10-04T15:00:00Z' }), row({ sold_at: '2026-10-05T15:00:00Z' })];
    const groups = groupActivity(items, groupingForPeriod('month'));
    expect(groups.map(group => group.key)).toEqual(['2026-09-28', '2026-10-05']);
    expect(groups[0]).toMatchObject({ billed: 50, commission: 20 });
    expect(groups[1]).toMatchObject({ billed: 25, commission: 10 });
  });
  it('separa citas del mismo cliente aunque sean del mismo día', () => {
    expect(groupActivity([row(), row({ appointment_id: 'appointment-2' })], 'appointment')).toHaveLength(2);
  });
});
