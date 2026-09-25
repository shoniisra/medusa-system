import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card } from './Card';

interface StatCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  hint?: string;
  tone?: 'gold' | 'white' | 'success' | 'danger';
  gold?: boolean;
  glow?: 'gold' | 'green';
  /** Variación vs. período anterior, ej: "+6" o "-3.2%". */
  trend?: { value: string; direction: 'up' | 'down' };
}

const toneClass = {
  gold: 'kpi-gold',
  white: 'text-white',
  success: 'text-success',
  danger: 'text-danger',
};

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = 'white',
  gold,
  glow,
  trend,
}: StatCardProps) {
  return (
    <Card gold={gold} glow={glow} className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <span className="text-sm text-white/50">{label}</span>
        {Icon && (
          <span className={cn('icon-badge h-9 w-9 rounded-xl', gold && 'icon-badge-gold')}>
            <Icon className="h-5 w-5" />
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
        <span className={cn('text-4xl font-semibold leading-none tracking-tight', toneClass[tone])}>
          {value}
        </span>
        {trend && (
          <span
            className={cn(
              'mb-1 inline-flex items-center gap-0.5 text-xs font-medium',
              trend.direction === 'up' ? 'text-success' : 'text-danger',
            )}
          >
            {trend.direction === 'up' ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      {hint && <span className="text-xs text-white/40">{hint}</span>}
    </Card>
  );
}
