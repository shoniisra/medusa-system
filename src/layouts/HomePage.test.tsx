import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';
import type { UserRole } from '@/types';

const state = vi.hoisted(() => ({ role: null as UserRole | null }));
vi.mock('@/store/session', () => ({
  useSession: (select: (s: { user: { role: UserRole } | null }) => unknown) =>
    select({ user: state.role ? { role: state.role } : null }),
}));
vi.mock('@/features/dashboard/DashboardPage', () => ({ DashboardPage: () => <div>Información gerencial</div> }));
vi.mock('@/features/dashboard/StaffDashboardPage', () => ({ StaffDashboardPage: () => <div>Mi dashboard personal</div> }));
vi.mock('@/features/calendar/CalendarViewPage', () => ({ CalendarViewPage: () => <div>Agenda operativa</div> }));

describe('dashboard según usuario activo', () => {
  beforeEach(() => { state.role = null; });
  it('Kelly → salir → Lesly muestra exclusivamente el dashboard personal', () => {
    state.role = 'manager';
    expect(renderToStaticMarkup(<HomePage />)).toContain('Información gerencial');
    state.role = null;
    expect(renderToStaticMarkup(<HomePage />)).toBe('');
    state.role = 'staff';
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('Mi dashboard personal');
    expect(html).not.toContain('Información gerencial');
  });
  it('recepción tampoco accede a métricas gerenciales desde el inicio', () => {
    state.role = 'cashier';
    expect(renderToStaticMarkup(<HomePage />)).toContain('Agenda operativa');
  });
});
