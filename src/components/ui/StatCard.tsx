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
}: StatCardProps) {
  return (
    <Card gold={gold} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-white/50">{label}</span>
        {Icon && <Icon className="h-5 w-5 text-gold-300/80" />}
      </div>
      <span className={cn('text-3xl leading-none', toneClass[tone])}>
        {value}
      </span>
      {hint && <span className="text-xs text-white/40">{hint}</span>}
    </Card>
  );
}
