import { describe, expect, it } from 'vitest';
import { auditChanges, auditValue } from './auditModel';

describe('detalle de auditoría', () => {
  it('muestra exclusivamente los campos modificados conservando antes/después', () => {
    expect(auditChanges({ before_data: JSON.stringify({ first_name: 'Lesly', phone: '111', notes: null }),
      after_data: JSON.stringify({ first_name: 'Lesly', phone: '222', notes: 'Alergia' }) })).toEqual([
      { key: 'phone', label: 'Teléfono', before: '111', after: '222' },
      { key: 'notes', label: 'Observaciones', before: null, after: 'Alergia' },
    ]);
  });
  it('conserva los datos de las eliminaciones y distingue cero de un campo vacío', () => {
    expect(auditChanges({ before_data: '{"amount":0}', after_data: null })).toEqual([
      { key: 'amount', label: 'Monto', before: 0, after: undefined },
    ]);
    expect(auditValue(0)).toBe('0');
    expect(auditValue(null)).toBe('—');
  });
});
