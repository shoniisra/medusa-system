import { useState } from 'react';
import { Stethoscope, KeyRound } from 'lucide-react';
import { RESOURCES } from './resources';
import { ResourceManager } from './ResourceManager';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { UserAccessPanel } from './UserAccessPanel';
import { cn } from '@/lib/cn';

const DIAGNOSTICS_KEY = '__diagnostics';
const ACCESS_KEY = '__access';

export function SettingsPage() {
  const [active, setActive] = useState<string>(RESOURCES[0].key);
  const resource = RESOURCES.find((r) => r.key === active);
  const isDiagnostics = active === DIAGNOSTICS_KEY;
  const isAccess = active === ACCESS_KEY;

  const tabClass = (key: string) =>
    cn(
      'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
      active === key
        ? 'border-gold/40 bg-gold/10 text-gold-200 shadow-gold-glow'
        : 'border-white/10 text-white/60 hover:bg-white/5 hover:text-white',
    );

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Configuración</h1>
        <p className="text-sm text-white/40">
          Administrá los catálogos y entidades principales del sistema.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {RESOURCES.map((r) => {
          const Icon = r.icon;
          return (
            <button key={r.key} onClick={() => setActive(r.key)} className={tabClass(r.key)}>
              <Icon className="h-4 w-4" />
              {r.label}
            </button>
          );
        })}
        <button onClick={() => setActive(ACCESS_KEY)} className={tabClass(ACCESS_KEY)}>
          <KeyRound className="h-4 w-4" />
          Accesos
        </button>
        <button onClick={() => setActive(DIAGNOSTICS_KEY)} className={tabClass(DIAGNOSTICS_KEY)}>
          <Stethoscope className="h-4 w-4" />
          Diagnóstico
        </button>
      </div>

      {isDiagnostics ? (
        <DiagnosticsPanel />
      ) : isAccess ? (
        <UserAccessPanel />
      ) : resource ? (
        <ResourceManager key={resource.key} resource={resource} />
      ) : null}
    </div>
  );
}
