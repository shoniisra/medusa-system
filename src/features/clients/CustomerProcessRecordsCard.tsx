import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hand, Palette, Plus, Trash2 } from 'lucide-react';
import { execute, query, type Stmt } from '@/lib/db';
import { dateShort, fullName, genId, todayISO } from '@/lib/format';
import { hasPermission } from '@/config/permissions';
import { useOrgId, useSession } from '@/store/session';
import { useStaff } from '@/features/pos/useCatalog';
import { Button, Card, CardHeader, DateInput, Modal, Select, useToast } from '@/components/ui';
import type { CustomerColorRecord, CustomerManicureRecord } from '@/types';

export type ProcessKind = 'color' | 'manicure';
type Field = 'formula' | 'brand' | 'developer' | 'result' | 'technique' | 'products' | 'shade' | 'notes';
export type ProcessRecord = Pick<CustomerColorRecord, 'id' | 'organization_id' | 'customer_id' | 'record_date' | 'staff_member_id' | 'created_by' | 'created_at'>
  & Partial<CustomerColorRecord & CustomerManicureRecord>;

export const PROCESS_CONFIG = {
  color: {
    table: 'customer_color_record', title: 'Procesos de color', latest: 'Último color', register: 'Registrar color',
    empty: 'Sin procesos de color registrados.',
    fields: [
      { key: 'formula', label: 'Fórmula', placeholder: 'Ej. 6.1 · 30 g + 40 g de oxidante 10 vol' },
      { key: 'brand', label: 'Marca', placeholder: '' },
      { key: 'developer', label: 'Oxidante', placeholder: 'Ej. 10 vol' },
      { key: 'result', label: 'Resultado', placeholder: 'Tono obtenido y zona aplicada' },
      { key: 'notes', label: 'Observaciones', placeholder: 'Tiempo de exposición, precauciones, próximos pasos…' },
    ],
  },
  manicure: {
    table: 'customer_manicure_record', title: 'Procesos de manicura', latest: 'Última manicura', register: 'Registrar manicura',
    empty: 'Sin procesos de manicura registrados.',
    fields: [
      { key: 'technique', label: 'Técnica', placeholder: 'Ej. Esmaltado semipermanente, refuerzo, retiro…' },
      { key: 'products', label: 'Productos', placeholder: 'Base, esmalte, top y marcas utilizadas' },
      { key: 'shade', label: 'Tono', placeholder: 'Nombre o código del color' },
      { key: 'notes', label: 'Observaciones', placeholder: 'Estado de las uñas, sensibilidades y cuidados…' },
    ],
  },
} satisfies Record<ProcessKind, { table: string; title: string; latest: string; register: string; empty: string; fields: { key: Field; label: string; placeholder: string }[] }>;

/** Only allow configured columns and tables, with all user data bound as parameters. */
export function createProcessStatement(kind: ProcessKind, values: {
  id: string; orgId: string; customerId: string; date: string;
  staffId: string | null; userId: string | null; draft: Partial<Record<Field, string>>;
}): Stmt {
  if (!values.orgId || !values.customerId) throw new Error('Elegí un cliente antes de registrar el proceso.');
  const config = PROCESS_CONFIG[kind];
  const fields = config.fields.map((field) => values.draft[field.key]?.trim() || null);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || Number.isNaN(Date.parse(values.date))
    || new Date(values.date).toISOString().slice(0, 10) !== values.date) {
    throw new Error('Elegí una fecha válida.');
  }
  if (!fields.some(Boolean)) throw new Error('Completá al menos un detalle del proceso.');
  const columns = ['id', 'organization_id', 'customer_id', 'record_date', ...config.fields.map((f) => f.key), 'staff_member_id', 'created_by'];
  return {
    sql: `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    args: [values.id, values.orgId, values.customerId, values.date, ...fields, values.staffId, values.userId],
  };
}

export function CustomerProcessRecordsCard({ customerId, kind, compact = false, readOnly = false }: {
  customerId: string; kind: ProcessKind; compact?: boolean; readOnly?: boolean;
}) {
  const orgId = useOrgId();
  const user = useSession((s) => s.user);
  const canDelete = !readOnly && hasPermission(user?.role, 'manage_clients');
  const staff = useStaff();
  const qc = useQueryClient();
  const toast = useToast();
  const config = PROCESS_CONFIG[kind];
  const Icon = kind === 'color' ? Palette : Hand;
  const [registerOpen, setRegisterOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [staffId, setStaffId] = useState('');
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const records = useQuery({
    queryKey: [`${kind}-records`, orgId, customerId],
    enabled: !!orgId && !!customerId,
    queryFn: () => query<ProcessRecord>(
      `SELECT * FROM ${config.table} WHERE organization_id = ? AND customer_id = ?
        ORDER BY record_date DESC, created_at DESC, id DESC`, [orgId, customerId],
    ),
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: [`${kind}-records`, orgId, customerId] });
    void qc.invalidateQueries({ queryKey: ['appt-customer-extras', customerId] });
  };
  const add = useMutation({
    mutationFn: () => {
      if (readOnly) throw new Error('Esta vista es solo de consulta.');
      const stmt = createProcessStatement(kind, {
        id: genId(), orgId, customerId, date, draft, staffId: staffId || null, userId: user?.id ?? null,
      });
      return execute(stmt.sql, stmt.args);
    },
    onSuccess: () => {
      setDraft({}); setStaffId(''); setDate(todayISO()); setRegisterOpen(false);
      invalidate(); toast.success(kind === 'color' ? 'Proceso de color registrado' : 'Proceso de manicura registrado');
    },
    onError: (e: Error) => toast.error('No se pudo registrar el proceso', e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => {
      if (!canDelete) throw new Error('No tenés permiso para eliminar procesos.');
      return execute(`DELETE FROM ${config.table} WHERE id = ? AND organization_id = ? AND customer_id = ?`, [id, orgId, customerId]);
    },
    onSuccess: () => { setDeletingId(null); invalidate(); toast.info('Proceso eliminado'); },
    onError: (e: Error) => toast.error('No se pudo eliminar', e.message),
  });
  const recordList = (rows: ProcessRecord[], preview = false) => (
    <ul className="space-y-3">
      {rows.map((record) => {
        const member = staff.data?.find((s) => s.id === record.staff_member_id);
        return (
          <li key={record.id} className={preview ? 'space-y-2' : 'space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3'}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-white/50">
                {dateShort(record.record_date)}
                {member && <span className="block">{fullName(member.first_name, member.last_name)}</span>}
              </p>
              {canDelete && !preview && (
                deletingId === record.id ? <div className="flex flex-wrap gap-2 text-xs">
                  <button onClick={() => setDeletingId(null)} className="text-white/50">Cancelar</button>
                  <button disabled={del.isPending} onClick={() => del.mutate(record.id)} className="text-danger">Eliminar</button>
                </div> : <button aria-label="Eliminar proceso" onClick={() => setDeletingId(record.id)} className="p-1 text-white/30 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
            <dl className="space-y-1.5 text-sm">
              {config.fields.map((field) => record[field.key] ? (
                <div key={field.key}>
                  <dt className="text-xs text-white/40">{field.label}</dt>
                  <dd className={`whitespace-pre-wrap break-words text-white/80 ${preview ? 'line-clamp-2' : ''}`}>{record[field.key]}</dd>
                </div>
              ) : null)}
            </dl>
          </li>
        );
      })}
    </ul>
  );
  const Container = compact ? 'section' : Card;
  return (
    <Container className={compact ? 'min-w-0 space-y-3' : undefined} aria-label={compact ? config.latest : config.title}>
      {compact ? <h3 className="flex items-center gap-2 text-sm font-medium text-gold-200"><Icon className="h-4 w-4 shrink-0" />{config.latest}</h3>
        : <CardHeader title={config.title} action={readOnly ? undefined : <Button size="sm" onClick={() => setRegisterOpen(true)}><Plus className="h-4 w-4" />Registrar</Button>} />}
      {records.isLoading ? <p role="status" className="text-xs text-white/40">Cargando procesos…</p>
        : records.isError ? <div role="alert" className="space-y-1 text-xs text-danger"><p>No se pudieron cargar los procesos.</p><button onClick={() => void records.refetch()} className="underline">Reintentar</button></div>
        : records.data?.length ? recordList(compact ? records.data.slice(0, 1) : records.data, compact)
        : <p className="text-xs text-white/40">{config.empty}</p>}
      {compact && <div className="flex flex-wrap gap-3 text-xs">
        {!!records.data?.length && <button onClick={() => setHistoryOpen(true)} className="text-gold-300 hover:underline">Ver historial ({records.data.length})</button>}
        {!readOnly && <button disabled={records.isError || records.isLoading} onClick={() => setRegisterOpen(true)} className="inline-flex items-center gap-1 text-gold-300 hover:underline disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Registrar</button>}
      </div>}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={config.title}>
        {recordList(records.data ?? [])}
        {!readOnly && <Button className="mt-4 w-full" onClick={() => { setHistoryOpen(false); setRegisterOpen(true); }}>Registrar proceso</Button>}
      </Modal>
      <Modal open={registerOpen} onClose={() => setRegisterOpen(false)} title={config.register}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateInput label="Fecha" value={date} onChange={setDate} clearable={false} />
            <Select label="Colaboradora" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Sin asignar</option>
              {staff.data?.map((s) => <option key={s.id} value={s.id}>{fullName(s.first_name, s.last_name)}</option>)}
            </Select>
          </div>
          {config.fields.map((field) => <label key={field.key} className="block">
            <span className="mb-1 block text-xs font-medium text-white/60">{field.label}</span>
            <textarea rows={field.key === 'notes' || field.key === 'formula' ? 2 : 1} className="input-base w-full resize-y" value={draft[field.key] ?? ''} placeholder={field.placeholder}
              onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))} />
          </label>)}
          <Button type="submit" className="w-full" loading={add.isPending} disabled={!date || !config.fields.some((f) => draft[f.key]?.trim())}>Guardar proceso</Button>
        </form>
      </Modal>
    </Container>
  );
}
