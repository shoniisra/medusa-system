/**
 * Celda compacta label + valor para los paneles de caja. Mismo bloque en el
 * modal de cierre y en la pestaña Caja.
 */
export function MetricCard({
  label,
  value,
  gold,
  tone,
  size = 'lg',
}: {
  label: string;
  value: string;
  gold?: boolean;
  tone?: 'danger' | 'success';
  size?: 'lg' | 'xl';
}) {
  const color = gold
    ? 'kpi-gold'
    : tone === 'danger'
      ? 'text-danger'
      : tone === 'success'
        ? 'text-success'
        : 'text-white';
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <p className="text-xs text-white/50">{label}</p>
      <p className={`mt-1 ${size === 'xl' ? 'text-xl' : 'text-lg'} font-semibold ${color}`}>
        {value}
      </p>
    </div>
  );
}
