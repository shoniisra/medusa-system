import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'gold' | 'success' | 'danger' | 'info' | 'muted';

const tones: Record<Tone, string> = {
  gold: 'bg-gold/15 text-gold-200 border-gold/30',
  success: 'bg-success/15 text-success border-success/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
  info: 'bg-info/15 text-info border-info/30',
  muted: 'bg-white/5 text-white/50 border-white/10',
};

export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
