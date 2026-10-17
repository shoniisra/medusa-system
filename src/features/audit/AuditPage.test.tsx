import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuditPage } from './AuditPage';
import type { UserRole } from '@/types';

const state = vi.hoisted<{ role: UserRole }>(() => ({ role: 'manager' }));
vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock('@/store/session', () => ({ useSession: (select: (value: unknown) => unknown) =>
  select({ user: { id: 'kelly', organization_id: 'org', role: state.role } }),
}));

describe('pantalla de auditoría', () => {
  it.each(['admin','manager'] as const)('muestra autor, fecha y cambios para %s', (role) => {
    state.role = role;
    const client = new QueryClient();
    client.setQueryData(['audit','org','kelly','',null], { next: null, actors: [], rows: [{
      id: 1, occurred_at: '2026-10-17T15:30:00Z', actor_name: 'Lesly', actor_role: 'staff', source: 'app',
      entity_type: 'customer', entity_id: 'client', record_id: 'client', table_name: 'customer', action: 'update',
      request_id: 'operation', before_data: '{"phone":"099111"}', after_data: '{"phone":"099222"}',
    }] });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><AuditPage /></QueryClientProvider>);
    for (const text of ['Lesly', 'Modificó', 'Cliente', 'Teléfono', '099111', '099222', 'Antes', 'Después']) expect(html).toContain(text);
    client.clear();
  });
  it.each(['staff','cashier'] as const)('no muestra historial a %s aunque se monte directamente', (role) => {
    state.role = role;
    expect(renderToStaticMarkup(<AuditPage />)).toBe('');
  });
});
