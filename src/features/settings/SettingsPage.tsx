import { useState } from 'react';
import { RESOURCES } from './resources';
import { ResourceManager } from './ResourceManager';
import { cn } from '@/lib/cn';

export function SettingsPage() {
  const [active, setActive] = useState(RESOURCES[0].key);
  const resource = RESOURCES.find((r) => r.key === active)!;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Configuración</h1>
        <p className="text-sm text-white/40">
          Administrá los catálogos y entidades principales del sistema.
        </p>
      </div>

      {/* Navegación por entidad */}
      <div className="flex flex-wrap gap-2">
        {RESOURCES.map((r) => {
          const Icon = r.icon;
          const isActive = r.key === active;
          return (
            <button
              key={r.key}
              onClick={() => setActive(r.key)}
              className={cn(
                'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'border-gold/40 bg-gold/10 text-gold-200 shadow-gold-glow'
                  : 'border-white/10 text-white/60 hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4" />
              {r.label}
            </button>
          );
        })}
      </div>

      <ResourceManager key={resource.key} resource={resource} />
    </div>
  );
}
