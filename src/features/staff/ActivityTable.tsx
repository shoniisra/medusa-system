import { money } from '@/lib/format';
import { groupActivity, groupingForPeriod, type ActivityRow, type Period } from './activityModel';

function serviceLabel(item: ActivityRow) {
  return item.role === 'assistant' ? `Ayuda: ${item.assist_label || 'asistencia'}` : item.service;
}

/** Una fila por cita, día o semana. El desglose solo ocupa espacio al abrirlo. */
export function ActivityTable({ items, period }: { items: ActivityRow[]; period: Period }) {
  const daily = period === 'day';
  return (
    <div className="overflow-x-auto px-2 pb-2">
      <table className="w-full min-w-[440px] text-xs">
        <thead className="text-left text-white/40">
          <tr>
            <th className="py-1.5 pr-2">{daily ? 'Cita / servicios' : period === 'week' ? 'Día / actividad' : 'Semana / actividad'}</th>
            {!daily && <th className="px-2 py-1.5 text-right">Citas</th>}
            <th className="px-2 py-1.5 text-right">Servicios</th>
            <th className="px-2 py-1.5 text-right">Cobrado</th>
            <th className="py-1.5 pl-2 text-right">Comisión</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {groupActivity(items, groupingForPeriod(period)).map(group => {
            const appointments = new Set(group.items.map(item => item.appointment_id || `sale:${item.sale_id}`)).size;
            const clients = [...new Set(group.items.map(item => item.client || 'Consumidor final'))];
            const services = group.items.map(serviceLabel).join(' · ');
            const time = new Date(group.items[0].sold_at).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
            return (
              <tr key={group.key} className="align-top text-white/75">
                <td className="py-2 pr-2">
                  <details>
                    <summary className="cursor-pointer text-white/90">
                      {daily ? `${clients.join(', ')} · ${time}` : group.label}
                      <span className="ml-1 text-white/30">ver detalle</span>
                    </summary>
                    <ul className="mt-2 space-y-1.5 border-l border-white/10 pl-2">
                      {group.items.map((item, index) => (
                        <li key={index} className="text-white/60">
                          {serviceLabel(item)} · {item.client || 'Consumidor final'}
                          <span className="ml-1 text-white/40">{item.sale_number} · {new Date(item.sold_at).toLocaleDateString('es-EC')}</span>
                          <span className="ml-1">{item.role === 'assistant' ? 'Ayuda' : money(item.amount)} · Comisión {money(item.commission)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <p title={daily ? services : clients.join(', ')} className="mt-0.5 max-w-[26rem] truncate text-[11px] text-white/40">
                    {daily ? services : `${clients.length} clientes · ${clients.join(', ')}`}
                  </p>
                </td>
                {!daily && <td className="px-2 py-2 text-right tabular-nums">{appointments}</td>}
                <td className="px-2 py-2 text-right tabular-nums">{group.items.length}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{money(group.billed)}</td>
                <td className="whitespace-nowrap py-2 pl-2 text-right font-medium tabular-nums text-gold-200">{money(group.commission)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
