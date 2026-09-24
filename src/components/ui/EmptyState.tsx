import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      {Icon && <Icon className="h-10 w-10 text-white/20" />}
      <div>
        <p className="text-sm font-medium text-white/70">{title}</p>
        {description && (
          <p className="mt-1 text-xs text-white/40">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
