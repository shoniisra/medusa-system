import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { BookingCustomerHistory } from './BookingCustomerHistory';
import { summarizeManicureHistory } from '@/features/clients/manicureHistory';

vi.mock('@/store/session', () => ({
  useOrgId: () => 'org',
  useSession: (select: (s: { user: { id: string; role: string } }) => unknown) => select({ user: { id: 'user', role: 'admin' } }),
}));

function render(customerId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(['staff', 'org'], []);
  qc.setQueryData(['manicure-history', 'org', 'known'], summarizeManicureHistory([{
    appointmentId: 'attended', startAt: '2026-10-13T10:00:00', description: 'Manicura - Base ruber',
    serviceName: null, category: 'Manicura', staffName: 'Colaboradora',
  }]));
  qc.setQueryData(['color-records', 'org', 'known'], [{
    id: 'color', record_date: '2026-09-25', formula: '6.1 · 30 g + 40 g', developer: '10 vol',
    result: 'Solo raíz', notes: 'No tocar mechas decoloradas', staff_member_id: null,
  }]);
  qc.setQueryData(['manicure-history', 'org', 'new'], { visits: [], usual: [] });
  qc.setQueryData(['color-records', 'org', 'new'], []);
  return renderToStaticMarkup(<QueryClientProvider client={qc}><BookingCustomerHistory customerId={customerId} /></QueryClientProvider>);
}

describe('referencias para agendar una cita', () => {
  it('muestra sistema realizado, fórmula, oxidante y precauciones del cliente elegido', () => {
    const html = render('known');
    for (const value of ['Última manicura', 'Rubber', 'Último color', '6.1 · 30 g + 40 g', '10 vol', 'No tocar mechas decoloradas']) {
      expect(html).toContain(value);
    }
    expect(html).toContain('Ver historial');
  });
  it('es de consulta, también para administración', () => {
    const html = render('known');
    for (const action of ['Registrar', 'Eliminar proceso', 'Ficha técnica manual', 'Guardar proceso']) {
      expect(html).not.toContain(action);
    }
  });
  it('no conserva los procesos de otro cliente cuando el seleccionado no tiene historial', () => {
    const html = render('new');
    expect(html).toContain('Sin manicuras en citas atendidas.');
    expect(html).toContain('Sin procesos de color registrados.');
    expect(html).not.toContain('Rubber');
    expect(html).not.toContain('6.1');
  });
  it('no muestra información antes de seleccionar o crear un cliente', () => {
    expect(render('')).toBe('');
  });
});
