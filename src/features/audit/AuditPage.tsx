import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { hasPermission, roleLabel } from '@/config/permissions';
import { useSession } from '@/store/session';
import { Button, Card, Input, Select } from '@/components/ui';
import { ACTION_LABELS, ENTITY_LABELS, TABLE_LABELS, auditChanges, auditValue, type AuditEntry } from './auditModel';
import type { UserRole } from '@/types';

interface AuditResult {
  rows: AuditEntry[];
  next: number | null;
  actors: { actor_id: string | null; actor_name: string }[];
}

export function AuditPage() {
  const role = useSession((s) => s.user?.role);
  if (!hasPermission(role, 'view_audit')) return null;
  return <AuditContent />;
}

function AuditContent() {
  const [search, setSearch] = useSearchParams();
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    next.delete('before');
    if (value) next.set(key, value); else next.delete(key);
    setSearch(next, { replace: true });
  };
  return <div className="mx-auto max-w-7xl space-y-5">
    <div>
      <h1 className="text-2xl font-semibold">Auditoría</h1>
      <p className="mt-1 text-sm text-white/50">Quién creó, modificó o eliminó cada registro. Fechas en hora de Ecuador.</p>
    </div>
    <Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="Módulo" value={search.get('entity_type') ?? ''} onChange={(e) => update('entity_type', e.target.value)}>
          <option value="">Todos</option>
          {Object.entries(ENTITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select label="Acción" value={search.get('action') ?? ''} onChange={(e) => update('action', e.target.value)}>
          <option value="">Todas</option><option value="create">Creación</option><option value="update">Modificación</option><option value="delete">Eliminación</option>
        </Select>
        <Input label="Desde" type="date" value={search.get('from') ?? ''} onChange={(e) => update('from', e.target.value)} />
        <Input label="Hasta" type="date" value={search.get('to') ?? ''} onChange={(e) => update('to', e.target.value)} />
        <Input label="ID de cita, venta o registro" value={search.get('entity_id') ?? ''} onChange={(e) => update('entity_id', e.target.value.trim())} />
      </div>
    </Card>
    <AuditResults key={search.toString()} search={search} update={update} />
    <p className="text-xs text-white/40">El registro comienza al activar la auditoría. Los cambios anteriores no se reconstruyen. Las escrituras externas sin sesión se muestran sin autor identificado.</p>
  </div>;
}

function AuditResults({ search, update }: { search: URLSearchParams; update: (key: string, value: string) => void }) {
  const user = useSession((s) => s.user);
  const [pages, setPages] = useState<(number | null)[]>([null]);
  const cursor = pages[pages.length - 1];
  const result = useQuery({
    queryKey: ['audit', user?.organization_id, user?.id, search.toString(), cursor],
    enabled: !!user && hasPermission(user.role, 'view_audit'),
    queryFn: async (): Promise<AuditResult> => {
      const params = new URLSearchParams(search);
      if (cursor !== null) params.set('before', String(cursor));
      const response = await fetch(`/api/audit?${params}`, { credentials: 'include', cache: 'no-store' });
      const data = await response.json() as AuditResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'No se pudo cargar la auditoría.');
      return data;
    },
  });
  return <Card>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <Select label="Persona" value={search.get('actor_id') ?? ''} onChange={(e) => update('actor_id', e.target.value)}>
        <option value="">Todas las personas y sistemas</option>
        {result.data?.actors.filter((a) => a.actor_id).map((actor) => <option key={`${actor.actor_id}-${actor.actor_name}`} value={actor.actor_id ?? ''}>{actor.actor_name}</option>)}
      </Select>
      <Button variant="outline" onClick={() => { void result.refetch(); }}>Actualizar</Button>
    </div>
    {result.isLoading && <p className="py-6 text-white/50">Cargando historial…</p>}
    {result.isError && <p role="alert" className="py-4 text-danger">{result.error.message}</p>}
    {result.data && <>
      {result.data.rows.length === 0 && <p className="py-6 text-white/50">No hay cambios registrados con estos filtros.</p>}
      <div className="space-y-3">
        {result.data.rows.map((entry) => <AuditRow key={entry.id} entry={entry} />)}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <Button variant="outline" disabled={pages.length === 1} onClick={() => setPages((old) => old.slice(0, -1))}>Anterior</Button>
        <span className="text-xs text-white/40">Página {pages.length}</span>
        <Button variant="outline" disabled={!result.data.next} onClick={() => setPages((old) => [...old, result.data.next])}>Siguiente</Button>
      </div>
    </>}
  </Card>;
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const changes = auditChanges(entry);
  const date = new Intl.DateTimeFormat('es-EC', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Guayaquil' }).format(new Date(entry.occurred_at));
  return <details className="rounded-xl border border-white/10 p-3">
    <summary className="cursor-pointer space-y-1 text-sm">
      <span className="font-medium">{entry.actor_name}</span>
      <span className="text-white/60"> · {ACTION_LABELS[entry.action] ?? entry.action} · {TABLE_LABELS[entry.table_name] ?? entry.table_name}</span>
      <span className="block text-xs text-white/40">{date} · {entry.actor_role ? roleLabel(entry.actor_role as UserRole) : entry.source === 'google-calendar' ? 'Sincronización' : 'Escritura externa'} · Registro {entry.entity_id}</span>
    </summary>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b border-white/10 text-white/50"><th className="p-2">Campo</th><th className="p-2">Antes</th><th className="p-2">Después</th></tr></thead>
        <tbody>{changes.map((change) => <tr key={change.key} className="border-b border-white/5 align-top">
          <th className="p-2 font-medium">{change.label}</th>
          <td className="max-w-sm whitespace-pre-wrap break-words p-2 text-white/50">{auditValue(change.before)}</td>
          <td className="max-w-sm whitespace-pre-wrap break-words p-2">{auditValue(change.after)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mt-3 break-all text-[10px] text-white/30">Evento #{entry.id} · Registro: {entry.record_id} · Operación: {entry.request_id ?? 'externa'}</p>
  </details>;
}
