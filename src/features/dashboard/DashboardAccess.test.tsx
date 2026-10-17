import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import { useDashboard } from './useDashboard';
import type { UserRole } from '@/types';

const state = vi.hoisted(() => ({ role: null as UserRole | null }));
vi.mock('@/store/session', () => ({
  useSession: (select: (s: { user: { role: UserRole } | null }) => unknown) =>
    select({ user: state.role ? { role: state.role } : null }),
}));
vi.mock('./useDashboard', () => ({ useDashboard: vi.fn(() => { throw new Error('Consulta gerencial prohibida'); }) }));

describe('barrera interna del dashboard gerencial', () => {
  it.each(['staff', 'cashier', null] as const)('bloquea %s incluso si se monta el componente directamente', (role) => {
    state.role = role;
    expect(renderToStaticMarkup(<DashboardPage />)).toBe('');
    expect(useDashboard).not.toHaveBeenCalled();
  });
});
