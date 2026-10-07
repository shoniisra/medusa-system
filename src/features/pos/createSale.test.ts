import { describe, it, expect } from 'vitest';
import { commissionForItem, resolveCommission, type CommissionRule } from './createSale';
import { DEFAULT_COMMISSION_RATE } from '@/config/constants';

/**
 * Reglas de comisión: núcleo del pago a estilistas. Testeamos sin DB porque
 * las dos funciones son puras y determinan cuánto cobra cada persona por una
 * línea de servicio.
 */

// Montos en dólares (como usan SaleItemsEditor y AppointmentPage) y rate en
// % entero: 40 significa 40 %. Las operaciones devuelven dólares también.

describe('resolveCommission', () => {
  it('porcentaje: 25 % de $100 → $25', () => {
    expect(resolveCommission('percentage', 25, 100)).toBe(25);
  });

  it('porcentaje: 40 % de $123,45 → $49,38 (redondeo a 2 decimales)', () => {
    // 123.45 * 40 = 4938.00 → /100 = 49.38
    expect(resolveCommission('percentage', 40, 123.45)).toBe(49.38);
  });

  it('fijo devuelve el monto sin tocarlo', () => {
    expect(resolveCommission('fixed', 7.5, 9999)).toBe(7.5);
  });

  it('porcentaje con base cero da cero', () => {
    expect(resolveCommission('percentage', 50, 0)).toBe(0);
  });
});

describe('commissionForItem', () => {
  const rules = new Map<string, CommissionRule>([
    ['staff-1:srv-A', { commission_type: 'percentage', commission_value: 50 }],
    ['staff-2:srv-B', { commission_type: 'fixed', commission_value: 5 }],
  ]);

  it('usa la regla configurada (porcentaje)', () => {
    const r = commissionForItem('staff-1', 'srv-A', 100, rules);
    expect(r.commission_type).toBe('percentage');
    expect(r.commission_rate).toBe(50);
    expect(r.commission_amount).toBe(50);
  });

  it('usa la regla configurada (fijo)', () => {
    const r = commissionForItem('staff-2', 'srv-B', 200, rules);
    expect(r.commission_type).toBe('fixed');
    expect(r.commission_rate).toBe(5);
    expect(r.commission_amount).toBe(5);
  });

  it('cae al % por defecto cuando no hay regla', () => {
    const r = commissionForItem('staff-X', 'srv-Y', 100, rules);
    expect(r.commission_type).toBe('percentage');
    expect(r.commission_rate).toBe(DEFAULT_COMMISSION_RATE);
    expect(r.commission_amount).toBe(DEFAULT_COMMISSION_RATE);
  });

  it('no mezcla reglas entre colaboradores con el mismo servicio', () => {
    // staff-1 tiene regla para srv-A, no para srv-B: debe caer al default.
    const r = commissionForItem('staff-1', 'srv-B', 100, rules);
    expect(r.commission_rate).toBe(DEFAULT_COMMISSION_RATE);
  });
});
