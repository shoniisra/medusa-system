import { describe, expect, it } from 'vitest';
import { hasPermission } from './permissions';

describe('acceso a clientes', () => {
  it('reserva la auditoría para administración y gerencia', () => {
    for (const role of ['admin', 'manager'] as const) expect(hasPermission(role, 'view_audit')).toBe(true);
    for (const role of ['staff', 'cashier', null] as const) expect(hasPermission(role, 'view_audit')).toBe(false);
  });
  it('excluye a colaboradoras del directorio conservando las operaciones', () => {
    expect(hasPermission('staff', 'manage_clients')).toBe(false);
    for (const permission of ['manage_appointments', 'attend_appointments', 'use_pos'] as const) {
      expect(hasPermission('staff', permission)).toBe(true);
    }
  });
  it('mantiene el directorio para administración, gerencia y recepción', () => {
    for (const role of ['admin', 'manager', 'cashier'] as const) {
      expect(hasPermission(role, 'manage_clients')).toBe(true);
    }
    expect(hasPermission(null, 'manage_clients')).toBe(false);
  });
});
