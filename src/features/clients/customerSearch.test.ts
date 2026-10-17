import { describe, expect, it } from 'vitest';
import { searchCustomers } from './customerSearch';
import type { Customer } from '@/types';

const customer = (id: string, first_name: string, phone: string | null): Customer =>
  ({ id, first_name, last_name: 'Gómez', phone, nickname: 'Mica', imported_name: 'Agenda salón', email: id === '1' ? 'maria@example.com' : 'ana@example.com' }) as Customer;
const list = [customer('1', 'María', '+593991234567'), customer('2', 'Ana', null)];

describe('búsqueda normal de clientes', () => {
  it('acepta nombres parciales, alias, agenda, teléfonos parciales y email', () => {
    for (const term of ['Mar', '99123', '234567', 'maria@']) {
      expect(searchCustomers(list, term)).toEqual([list[0]]);
    }
    for (const term of ['Mica', 'Agenda']) {
      expect(searchCustomers(list, term)).toEqual(list);
    }
  });
  it('no distingue mayúsculas y omite espacios externos', () => {
    expect(searchCustomers(list, ' MARÍA ')).toEqual([list[0]]);
  });
  it('restaura los ocho resultados habituales', () => {
    const matches = Array.from({ length: 10 }, (_, i) => customer(`${i}`, 'Ana', null));
    expect(searchCustomers(matches, 'Ana')).toHaveLength(8);
  });
  it('no lista clientes sin una búsqueda', () => {
    expect(searchCustomers(list, '')).toEqual([]);
    expect(searchCustomers(list, '  ')).toEqual([]);
  });
});
