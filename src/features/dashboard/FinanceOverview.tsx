import { Sparkles } from 'lucide-react';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Donut } from '@/components/ui';
import {
  usePeriodFinance,
  type PeriodKey,
  type PeriodFinance,
} from './usePeriodFinance';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
];

/** Tarjeta hero con 3 donas de ingresos vs egresos: día, semana y mes. */
export function FinanceOverview() {
  const { data, isLoading } = usePeriodFinance();

  return (
    <section className="finance-hero relative overflow-hidden rounded-2xl p-3 sm:rounded-3xl sm:p-6">
      {/* halos de fondo del hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl"
      />

      <div className="relative mb-3 flex items-center gap-2 sm:mb-6 sm:gap-3">
        <span className="icon-badge icon-badge-gold h-8 w-8 sm:h-11 sm:w-11">
          <Sparkles className="h-4 w-4 sm:h-5 sm:w-5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-white sm:text-base">
            Resumen financiero
          </h2>
          <p className="hidden text-xs text-white/45 sm:block">Ingresos vs egresos</p>
        </div>
      </div>

      <div className="relative grid grid-cols-3 gap-2 sm:gap-3">
        {PERIODS.map((p) => (
          <PeriodDonutCard
            key={p.key}
            label={p.label}
            f={data?.[p.key]}
            isLoading={isLoading}
          />
        ))}
      </div>
    </section>
  );
}

function PeriodDonutCard({
  label,
  f,
  isLoading,
}: {
  label: string;
  f: PeriodFinance | undefined;
  isLoading: boolean;
}) {
  const income = f?.received ?? 0;
  const expense = f?.expenses ?? 0;
  const total = f?.profit ?? 0;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2 transition-all hover:border-white/15 sm:rounded-2xl sm:p-4">
      {/* Mobile: dona grande arriba, período + total abajo. Compacto en una fila de 3. */}
      <div className="flex flex-col items-center gap-1.5 sm:hidden">
        <p className="text-[10px] font-medium uppercase tracking-wide text-white/60">
          {label}
        </p>
        <Donut income={income} expense={expense} size={56} />
        <p
          className={cn(
            'truncate text-[12px] font-semibold leading-none',
            total >= 0 ? 'text-success' : 'text-danger',
          )}
          title={isLoading ? '' : money(total)}
        >
          {isLoading ? '—' : money(total)}
        </p>
      </div>

      {/* Desktop: layout original con detalle de ingresos/egresos/total. */}
      <div className="hidden sm:block">
        <p className="mb-3 text-sm font-medium text-white">{label}</p>
        <div className="flex items-center gap-4">
          <Donut income={income} expense={expense} />
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-white/50">Ingresos</span>
              <span className="font-medium text-success">
                {isLoading ? '—' : money(income)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Egresos</span>
              <span className="font-medium text-danger">
                {isLoading ? '—' : money(expense)}
              </span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-1">
              <span className="text-white/50">Total</span>
              <span
                className={cn(
                  'font-semibold',
                  total >= 0 ? 'text-success' : 'text-danger',
                )}
              >
                {isLoading ? '—' : money(total)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Gráfico de barras simple en SVG (sin dependencias). */
export function MiniBarChart({
  data,
  height = 160,
}: {
  data: { label: string; sales: number }[];
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.sales));
  const cols = data.length || 1;

  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.sales / max) * (height - 28));
        const isLast = i === cols - 1;
        return (
          <div
            key={d.label}
            className="flex flex-1 flex-col items-center justify-end gap-1.5"
          >
            <span className="text-[10px] font-medium text-white/50">
              {d.sales > 0 ? money(d.sales) : ''}
            </span>
            <div
              className={cn(
                'w-full rounded-t-lg transition-all',
                isLast
                  ? 'bg-gradient-to-t from-gold-500/60 to-gold-300 shadow-gold-glow'
                  : 'bg-white/10',
              )}
              style={{ height: h }}
            />
            <span className="text-[10px] uppercase text-white/30">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Medidor semicircular (gauge) en SVG para porcentajes. */
export function Gauge({
  value,
  label,
  tone = 'gold',
}: {
  value: number; // 0..100
  label: string;
  tone?: 'gold' | 'emerald' | 'rose';
}) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 52;
  const c = Math.PI * r; // media circunferencia
  const dash = (pct / 100) * c;
  const stroke =
    tone === 'emerald' ? '#34d399' : tone === 'rose' ? '#fb7185' : '#f4c752';

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 80" className="w-44">
        <path
          d="M 18 74 A 52 52 0 0 1 122 74"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M 18 74 A 52 52 0 0 1 122 74"
          fill="none"
          stroke={stroke}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ filter: `drop-shadow(0 0 6px ${stroke}66)` }}
        />
        <text
          x="70"
          y="66"
          textAnchor="middle"
          className="fill-white"
          style={{ fontSize: 22, fontWeight: 700 }}
        >
          {Math.round(pct)}%
        </text>
      </svg>
      <p className="-mt-1 text-xs text-white/40">{label}</p>
    </div>
  );
}
