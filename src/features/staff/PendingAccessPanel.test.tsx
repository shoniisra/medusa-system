import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PendingAccessPanel } from './PendingAccessPanel';

const accounts = [
  { userId: 'admin', name: 'Administración', hasPassword: false },
  { userId: 'kelly', name: 'Kelly', hasPassword: true },
];
describe('asignación inicial de acceso desde gerencia', () => {
  it('ofrece asignar token solo a cuentas sin credencial', () => {
    const html = renderToStaticMarkup(<PendingAccessPanel role="manager" accounts={accounts} onSelect={() => undefined} />);
    expect(html).toContain('Administración');
    expect(html).toContain('Asignar token');
    expect(html).not.toContain('Kelly');
    expect(html).not.toContain('Editar rol');
  });
  it.each(['staff','cashier', undefined] as const)('no ofrece esta acción para %s', (role) => {
    expect(renderToStaticMarkup(<PendingAccessPanel role={role} accounts={accounts} onSelect={() => undefined} />)).toBe('');
  });
  it('no muestra el panel si todas las cuentas ya tienen credencial', () => {
    expect(renderToStaticMarkup(<PendingAccessPanel role="manager" accounts={accounts.slice(1)} onSelect={() => undefined} />)).toBe('');
  });
});
