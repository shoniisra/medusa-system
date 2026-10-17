import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActivityTable } from './ActivityTable';
import type { ActivityRow, Period } from './activityModel';

const items: ActivityRow[] = Array.from({ length: 12 }, (_, index) => ({
  staff_id: 'staff', service: `Servicio ${index}`, client: 'Ana', amount: 10,
  commission: 4, role: 'primary', assist_label: null,
  sold_at: `2026-10-${index < 6 ? '16' : '17'}T15:00:00Z`,
  sale_id: `sale-${index}`, sale_number: `V${index}`, appointment_id: `appointment-${Math.floor(index / 2)}`,
}));

describe('tablas compactas de actividad', () => {
  it.each<[Period, number]>([['day', 6], ['week', 2], ['month', 1]])(
    '%s resume los servicios en %s filas con el detalle cerrado', (period, count) => {
      const html = renderToStaticMarkup(<ActivityTable items={items} period={period} />);
      const body = html.split('<tbody')[1];
      expect(body.match(/<tr\b/g)).toHaveLength(count);
      expect(body.match(/<details>/g)).toHaveLength(count);
      expect(html).not.toContain('<details open');
      for (const item of items) expect(html).toContain(item.service);
    },
  );
});
