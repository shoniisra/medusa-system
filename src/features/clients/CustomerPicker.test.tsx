import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerPicker } from './CustomerPicker';
import { CustomerFields } from './CustomerFields';
import type { Customer } from '@/types';

const session = vi.hoisted(() => ({ user: { role: 'staff' } }));
vi.mock('@/store/session', () => ({ useSession: (select: (s: typeof session) => unknown) => select(session) }));
const customer = {
  id: 'client', first_name: 'María', last_name: 'Gómez', nickname: null,
  phone: '+593991234567', email: 'maria@example.com',
} as Customer;
const noop = () => undefined;
const props = {
  customerId: '', newClient: false, selectedCustomer: undefined,
  firstName: '', lastName: '', phone: '', clientSearch: 'Mar', clientMatches: [customer],
  phoneTaken: null, renameTo: null, useExistingBusy: false,
  searchPlaceholder: 'Buscar', phoneUseHint: '',
  onSearchChange: noop, onPhoneChange: noop, onPickExisting: noop, onStartNewClient: noop,
  onClear: noop, onUseExisting: noop,
};
beforeEach(() => { session.user.role = 'staff'; });

describe('visibilidad de contactos por contexto', () => {
  it('no incluye teléfono ni email completos en los resultados, incluso desde POS', () => {
    const html = renderToStaticMarkup(<CustomerPicker {...props} revealSelectedContact />);
    expect(html).not.toContain(customer.phone);
    expect(html).not.toContain(customer.email);
    expect(html).toContain('4567');
    expect(html).toContain('m•••@e•••.com');
  });
  it('mantiene enmascarado el cliente seleccionado al agendar', () => {
    const html = renderToStaticMarkup(<CustomerPicker {...props} customerId={customer.id} selectedCustomer={customer} />);
    expect(html).not.toContain(customer.phone);
    expect(html).not.toContain(customer.email);
  });
  it('revela solo el contacto seleccionado en la venta activa', () => {
    const html = renderToStaticMarkup(<CustomerPicker {...props} customerId={customer.id} selectedCustomer={customer} revealSelectedContact />);
    expect(html).toContain(customer.phone);
    expect(html).toContain(customer.email);
  });
  it('conserva contactos visibles para administración', () => {
    session.user.role = 'admin';
    const html = renderToStaticMarkup(<CustomerPicker {...props} />);
    expect(html).toContain(customer.phone);
    expect(html).toContain(customer.email);
  });
  it('no filtra datos completos en los campos de edición fuera de atención', () => {
    const html = renderToStaticMarkup(<CustomerFields maskContact draft={{
      firstName: 'María', lastName: 'Gómez', nickname: '', importedName: '',
      phone: customer.phone!, email: customer.email!, birth: '', taxId: '',
    }} set={noop} />);
    expect(html).not.toContain(customer.phone);
    expect(html).not.toContain(customer.email);
    expect(html).toContain('readonly');
  });
});
