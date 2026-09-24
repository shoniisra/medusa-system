import { useState } from 'react';
import {
  TrendingUp,
  Banknote,
  Receipt,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { money } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  usePeriodFinance,
  type PeriodKey,
  type PeriodFinance,
} from './usePeriodFinance';

const TABS: { key: PeriodKey; label: string }[] = [
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
];

/** Card con tabs día/semana/mes: Ventas, Recibido, Egresos, Ganancias. */
export function FinanceOverview() {
  const [tab, setTab] = useState<PeriodKey>('day');
  const { data, isLoading } = usePeriodFinance();
  const f: PeriodFinance | undefined = data?.[tab];

  return (
    <section className="glass-card relative overflow-hidden p-5">
      {/* halo dorado de fondo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold/10 blur-3xl"
      />
      <div className="relative mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">Resumen financiero</h2>
        <div className="flex rounded-xl bg-white/5 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                tab === t.key
                  ? 'bg-gold-400 text-ink-950 shadow-gold-glow'
                  : 'text-white/50 hover:text-white',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          icon={TrendingUp}
          label="Ventas"
          value={isLoading ? '—' : money(f?.sales)}
          accent="gold"
        />
        <Tile
          icon={Banknote}
          label="Dinero recibido"
          value={isLoading ? '—' : money(f?.received)}
          accent="emerald"
        />
        <Tile
          icon={Receipt}
          label="Egresos"
          value={isLoading ? '—' : money(f?.expenses)}
          accent="rose"
        />
        <Tile
          icon={Wallet}
          label="Ganancias"
          value={isLoading ? '—' : money(f?.profit)}
          accent={(f?.profit ?? 0) >= 0 ? 'emerald' : 'rose'}
          hint="Recibido − egresos"
        />
      </div>
    </section>
  );
}

const ACCENTS = {
  gold: 'text-gold-300 bg-gold/10 ring-gold/20',
  emerald: 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/20',
  rose: 'text-rose-300 bg-rose-400/10 ring-rose-400/20',
} as const;

function Tile({
  icon: Icon,
  label,
  value,
  accent,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: keyof typeof ACCENTS;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
      <div
        className={cn(
          'mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ring-1',
          ACCENTS[accent],
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-white/25">{hint}</p>}
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
