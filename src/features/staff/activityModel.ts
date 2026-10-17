import { fromISO, ymd } from '@/lib/date';

export type Period = 'day' | 'week' | 'month';
export type Grouping = 'appointment' | 'day' | 'week';

export function weekBounds(ref: Date): { from: string; to: string } {
  const mon = new Date(ref);
  mon.setDate(ref.getDate() - (ref.getDay() + 6) % 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: ymd(mon), to: ymd(sun) };
}

export function periodBounds(period: Period, anchor: string) {
  const date = fromISO(anchor);
  if (!date) return null;
  if (period === 'week') return weekBounds(date);
  if (period === 'month') return {
    from: ymd(new Date(date.getFullYear(), date.getMonth(), 1)),
    to: ymd(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
  return { from: anchor, to: anchor };
}

/** Límites UTC del período local, con el final exclusivo. */
export function timestampBounds(from: string, to: string) {
  const start = fromISO(from)!;
  const end = fromISO(to)!;
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export interface ActivityRow {
  staff_id: string;
  service: string;
  client: string | null;
  amount: number;
  commission: number;
  role: string;
  assist_label: string | null;
  sold_at: string;
  sale_id: string;
  sale_number: string;
  appointment_id: string | null;
}

export function activityTotals(items: ActivityRow[]) {
  return items.reduce((sum, row) => ({
    billed: sum.billed + (row.role === 'assistant' ? 0 : row.amount ?? 0),
    commission: sum.commission + (row.commission ?? 0),
  }), { billed: 0, commission: 0 });
}

export function groupActivity(items: ActivityRow[], grouping: Grouping) {
  const groups = new Map<string, { key: string; label: string; items: ActivityRow[] }>();
  for (const item of items) {
    const day = ymd(new Date(item.sold_at));
    const week = weekBounds(fromISO(day)!);

    const key = grouping === 'appointment' ? (item.appointment_id ? `appointment:${item.appointment_id}` : `sale:${item.sale_id}`)
      : grouping === 'day' ? day : week.from;
    const label = grouping === 'appointment'
      ? `${item.client || 'Consumidor final'} · ${item.appointment_id ? 'Cita' : 'Venta sin cita'} · ${day.split('-').reverse().join('/')} · ${item.sale_number}`
      : grouping === 'day' ? day.split('-').reverse().join('/')
      : `Semana ${week.from.split('-').reverse().join('/')} – ${week.to.split('-').reverse().join('/')}`;
    const group = groups.get(key) ?? { key, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, ...activityTotals(group.items) }));
}

export function groupingForPeriod(period: Period): Grouping {
  return period === 'day' ? 'appointment' : period === 'week' ? 'day' : 'week';
}
