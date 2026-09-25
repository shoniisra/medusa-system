import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  gold?: boolean;
  /** Resplandor de color desde una esquina, como la referencia. */
  glow?: 'gold' | 'green';
  /** Realce al pasar el cursor (para tarjetas clicables). */
  hover?: boolean;
  children: ReactNode;
}

export function Card({
  gold,
  glow,
  hover,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        gold ? 'glass-card-gold' : 'glass-card',
        glow === 'gold' && 'glass-card-glow glass-card-glow-gold',
        glow === 'green' && 'glass-card-glow glass-card-glow-green',
        hover && 'glass-card-hover',
        'p-5',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-medium text-white/70">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-white/40">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
