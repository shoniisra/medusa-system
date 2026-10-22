import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PieChart } from 'lucide-react';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { query } from '@/lib/db';
import { money } from '@/lib/format';
import { ADJUST_MARK } from './cashSessionActions';

interface CategorySlice {
  category_id: string;
  category_name: string;
  total: number;
}

/**
 * Paleta de colores para la torta. Suficiente contraste para que categorías
 * contiguas se distingan en pantalla y en impresión.
 */
const PALETTE = [
  '#F59E0B', // ámbar
  '#60A5FA', // azul
  '#34D399', // verde
  '#F87171', // rojo
  '#A78BFA', // violeta
  '#FBBF24', // amarillo
  '#2DD4BF', // teal
  '#F472B6', // rosa
  '#94A3B8', // slate
  '#FB923C', // naranja
];

/**
 * Torta + leyenda de gastos del mes agrupados por categoría. Se usa en el tab
 * Resumen; responde la pregunta "en qué se me va la plata" sin exportar.
 */
export function CategoryPieCard({
  branchId,
  month,
}: {
  branchId: string;
  month: string;
}) {
  const data = useQuery({
    queryKey: ['fin-cat-pie', branchId, month],
    enabled: !!branchId,
    queryFn: () =>
      query<CategorySlice>(
        `SELECT ec.id AS category_id, ec.name AS category_name,
                SUM(e.amount) AS total
           FROM expense e
           JOIN expense_category ec ON ec.id = e.expense_category_id
          WHERE e.branch_id = ?
            AND e.status <> 'voided'
            AND substr(e.expense_date, 1, 7) = ?
            AND COALESCE(e.description,'') NOT LIKE '${ADJUST_MARK}%'
          GROUP BY ec.id, ec.name
          HAVING SUM(e.amount) > 0
          ORDER BY total DESC`,
        [branchId, month],
      ),
  });

  const slices = useMemo(() => data.data ?? [], [data.data]);
  const total = slices.reduce((a, s) => a + s.total, 0);

  return (
    <Card>
      <CardHeader
        title="Gastos por categoría"
        subtitle={total > 0 ? `Total: ${money(total)}` : 'Sin datos del mes'}
      />
      {total === 0 ? (
        <EmptyState icon={PieChart} title="Sin gastos en el mes" />
      ) : (
        <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start">
          <PieSvg slices={slices} total={total} />
          <ul className="flex-1 space-y-2 w-full">
            {slices.map((s, i) => {
              const pct = (s.total / total) * 100;
              return (
                <li
                  key={s.category_id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-sm"
                      style={{ background: PALETTE[i % PALETTE.length] }}
                    />
                    <span className="truncate text-white">{s.category_name}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="font-medium text-white">
                      {money(s.total)}
                    </span>
                    <span className="ml-2 text-xs text-white/40">
                      {pct.toFixed(1)}%
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function PieSvg({
  slices,
  total,
}: {
  slices: CategorySlice[];
  total: number;
}) {
  const size = 160;
  const r = 70;
  const cx = size / 2;
  const cy = size / 2;
  // Prefix sums: evita reasignar un acumulador tras el render (regla de hooks).
  const bounds = slices.reduce<number[]>((acc, s) => {
    const prev = acc[acc.length - 1] ?? 0;
    acc.push(prev + s.total / total);
    return acc;
  }, [0]);
  const paths = slices.map((s, i) => {
    const start = bounds[i];
    const end = bounds[i + 1];
    const frac = end - start;
    const [x1, y1] = pointOn(cx, cy, r, start);
    const [x2, y2] = pointOn(cx, cy, r, end);
    const large = frac > 0.5 ? 1 : 0;
    // Caso de slice único: el arco colapsa, así que un círculo lleno sirve.
    if (slices.length === 1) {
      return (
        <circle
          key={s.category_id}
          cx={cx}
          cy={cy}
          r={r}
          fill={PALETTE[i % PALETTE.length]}
        />
      );
    }
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return (
      <path
        key={s.category_id}
        d={d}
        fill={PALETTE[i % PALETTE.length]}
      />
    );
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
      <circle cx={cx} cy={cy} r={r * 0.55} fill="#0b0b0f" />
    </svg>
  );
}

function pointOn(
  cx: number,
  cy: number,
  r: number,
  frac: number,
): [number, number] {
  const angle = frac * 2 * Math.PI - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}
