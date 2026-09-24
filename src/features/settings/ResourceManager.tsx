import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  Power,
  Trash2,
  AlertTriangle,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
import type { InValue } from '@libsql/client';
import { query, execute } from '@/lib/db';
import { genId } from '@/lib/format';
import { useOrgId } from '@/store/session';
import {
  Button,
  Card,
  Modal,
  Input,
  Select,
  Badge,
  EmptyState,
} from '@/components/ui';
import type { Branch } from '@/types';
import type { Field, ResourceConfig } from './resources';

type Row = Record<string, unknown>;
type FormState = Record<string, string | boolean>;

export function ResourceManager({ resource }: { resource: ResourceConfig }) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ idx: number; dir: 'asc' | 'desc' } | null>(
    null,
  );

  const listKey = ['resource', resource.key, orgId];

  const rows = useQuery({
    queryKey: listKey,
    enabled: !!orgId,
    queryFn: () => {
      if (resource.listSql) {
        const { sql, args } = resource.listSql(orgId);
        return query<Row>(sql, args);
      }
      const where = resource.autoScopeOrg ? 'WHERE organization_id = ?' : '';
      const args = resource.autoScopeOrg ? [orgId] : [];
      return query<Row>(
        `SELECT * FROM ${resource.table} ${where} ORDER BY ${resource.orderBy}`,
        args,
      );
    },
  });

  // Opciones de sucursal para campos FK (optionsKey === 'branches').
  const needsBranches = resource.fields.some((f) => f.optionsKey === 'branches');
  const branches = useQuery({
    queryKey: ['branches-options', orgId],
    enabled: needsBranches && !!orgId,
    queryFn: () =>
      query<Branch>(
        'SELECT id, name FROM branch WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: listKey });

  const toggleActive = useMutation({
    mutationFn: (row: Row) =>
      execute(`UPDATE ${resource.table} SET active = ? WHERE id = ?`, [
        row.active ? 0 : 1,
        row.id as string,
      ]),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (row: Row) =>
      execute(`DELETE FROM ${resource.table} WHERE id = ?`, [row.id as string]),
    onSuccess: () => {
      setToDelete(null);
      invalidate();
    },
  });

  const cols = resource.columns;

  // Filtro (busca en todos los valores de la fila) + orden por columna.
  const visibleRows = useMemo(() => {
    let data = rows.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      data = data.filter((r) =>
        Object.values(r).some(
          (v) => v != null && String(v).toLowerCase().includes(q),
        ),
      );
    }
    if (sort) {
      const col = cols[sort.idx];
      data = [...data].sort((a, b) => {
        const av = String(col.render(a) ?? '');
        const bv = String(col.render(b) ?? '');
        const cmp = av.localeCompare(bv, 'es', {
          numeric: true,
          sensitivity: 'base',
        });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return data;
  }, [rows.data, search, sort, cols]);

  const toggleSort = (idx: number) =>
    setSort((prev) =>
      prev?.idx === idx
        ? prev.dir === 'asc'
          ? { idx, dir: 'desc' }
          : null
        : { idx, dir: 'asc' },
    );

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{resource.label}</h2>
          <p className="text-xs text-white/40">
            {search.trim()
              ? `${visibleRows.length} de ${rows.data?.length ?? 0}`
              : `${rows.data?.length ?? 0} registros`}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Nuevo
        </Button>
      </div>

      {/* Búsqueda */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Buscar en ${resource.label.toLowerCase()}…`}
          className="input-base pl-9"
        />
      </div>

      {rows.isError && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" />
          {rows.error instanceof Error ? rows.error.message : 'Error al cargar'}
        </div>
      )}

      {rows.data && rows.data.length > 0 ? (
        <div className="max-h-[60vh] overflow-auto rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-white/40 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-ink-900 [&_th]:py-2">
                {cols.map((c, idx) => {
                  const isSorted = sort?.idx === idx;
                  const SortIcon = !isSorted
                    ? ChevronsUpDown
                    : sort!.dir === 'asc'
                      ? ChevronUp
                      : ChevronDown;
                  return (
                    <th
                      key={c.header}
                      className={c.align === 'right' ? 'text-right' : ''}
                    >
                      <button
                        onClick={() => toggleSort(idx)}
                        className={`inline-flex items-center gap-1 transition-colors hover:text-white ${
                          c.align === 'right' ? 'flex-row-reverse' : ''
                        } ${isSorted ? 'text-gold-200' : ''}`}
                      >
                        {c.header}
                        <SortIcon className="h-3 w-3" />
                      </button>
                    </th>
                  );
                })}
                {resource.hasActive && <th>Estado</th>}
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleRows.length === 0 && (
                <tr>
                  <td
                    colSpan={cols.length + (resource.hasActive ? 2 : 1)}
                    className="py-6 text-center text-sm text-white/40"
                  >
                    Sin coincidencias para “{search}”.
                  </td>
                </tr>
              )}
              {visibleRows.map((row) => (
                <tr
                  key={String(row.id)}
                  className={resource.hasActive && !row.active ? 'opacity-40' : ''}
                >
                  {cols.map((c) => (
                    <td
                      key={c.header}
                      className={`py-2.5 ${c.align === 'right' ? 'text-right' : ''}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                  {resource.hasActive && (
                    <td className="py-2.5">
                      <Badge tone={row.active ? 'success' : 'muted'}>
                        {row.active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                  )}
                  <td className="py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn
                        title="Editar"
                        onClick={() => setEditing(row)}
                        icon={Pencil}
                      />
                      {resource.hasActive && (
                        <IconBtn
                          title={row.active ? 'Desactivar' : 'Activar'}
                          onClick={() => toggleActive.mutate(row)}
                          icon={Power}
                        />
                      )}
                      <IconBtn
                        title="Eliminar"
                        danger
                        onClick={() => setToDelete(row)}
                        icon={Trash2}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !rows.isLoading && (
          <EmptyState
            icon={resource.icon}
            title={`Sin ${resource.label.toLowerCase()}`}
            description="Creá el primer registro."
          />
        )
      )}

      {(creating || editing) && (
        <ResourceForm
          resource={resource}
          row={editing}
          branchOptions={
            branches.data?.map((b) => ({ value: b.id, label: b.name })) ?? []
          }
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            invalidate();
          }}
        />
      )}

      {/* Confirmación de eliminado (hard delete) */}
      <Modal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title={`Eliminar ${resource.singular}`}
      >
        <p className="text-sm text-white/70">
          ¿Seguro que querés eliminar este registro de forma permanente? Si tiene
          movimientos asociados, la base puede impedirlo — en ese caso usá
          “Desactivar”.
        </p>
        {remove.isError && (
          <p className="mt-2 text-xs text-danger">
            {remove.error instanceof Error
              ? remove.error.message
              : 'No se pudo eliminar (probablemente tiene registros relacionados).'}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => setToDelete(null)}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={remove.isPending}
            onClick={() => toDelete && remove.mutate(toDelete)}
          >
            Eliminar
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

/* ─────────────────────────────── Formulario ──────────────────────────────── */

function ResourceForm({
  resource,
  row,
  branchOptions,
  onClose,
  onSaved,
}: {
  resource: ResourceConfig;
  row: Row | null;
  branchOptions: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const orgId = useOrgId();
  const isEdit = !!row;

  const initial = useMemo<FormState>(() => {
    const st: FormState = {};
    for (const f of resource.fields) {
      const v = row?.[f.name];
      st[f.name] =
        f.type === 'checkbox' ? Boolean(v) : v == null ? '' : String(v);
    }
    return st;
  }, [resource.fields, row]);

  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState('');

  const set = (name: string, value: string | boolean) =>
    setForm((s) => ({ ...s, [name]: value }));

  const coerce = (f: Field): InValue => {
    const raw = form[f.name];
    if (f.type === 'checkbox') return raw ? 1 : 0;
    const str = String(raw ?? '').trim();
    if (str === '') return f.required ? '' : null;
    if (f.type === 'number' || f.type === 'money') return Number(str);
    return str;
  };

  const save = useMutation({
    mutationFn: async () => {
      // Validación mínima de requeridos.
      for (const f of resource.fields) {
        if (f.required && String(form[f.name] ?? '').trim() === '') {
          throw new Error(`El campo “${f.label}” es obligatorio.`);
        }
      }

      const names = resource.fields.map((f) => f.name);
      const values = resource.fields.map((f) => coerce(f));

      // Unicidad por columna (ej: 1 caja registradora por sucursal). Solo al crear.
      if (!isEdit && resource.uniqueScope) {
        const scopeVal = String(form[resource.uniqueScope.column] ?? '').trim();
        if (scopeVal) {
          const existing = await query<{ id: string }>(
            `SELECT id FROM ${resource.table} WHERE ${resource.uniqueScope.column} = ? LIMIT 1`,
            [scopeVal],
          );
          if (existing.length > 0) throw new Error(resource.uniqueScope.message);
        }
      }

      if (isEdit) {
        const sets = [...names.map((n) => `${n} = ?`)];
        const args: InValue[] = [...values];
        if (resource.hasUpdatedAt) {
          sets.push('updated_at = ?');
          args.push(new Date().toISOString());
        }
        args.push(row!.id as string);
        await execute(
          `UPDATE ${resource.table} SET ${sets.join(', ')} WHERE id = ?`,
          args,
        );
      } else {
        const cols = ['id', ...(resource.autoScopeOrg ? ['organization_id'] : []), ...names];
        const args: InValue[] = [
          genId(),
          ...(resource.autoScopeOrg ? [orgId] : []),
          ...values,
        ];
        const placeholders = cols.map(() => '?').join(', ');
        await execute(
          `INSERT INTO ${resource.table} (${cols.join(', ')}) VALUES (${placeholders})`,
          args,
        );
      }
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : 'Error al guardar'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${isEdit ? 'Editar' : 'Nuevo'} ${resource.singular}`}
    >
      <div className="grid grid-cols-2 gap-3">
        {resource.fields.map((f) => {
          const span = f.colSpan === 2 ? 'col-span-2' : 'col-span-2 sm:col-span-1';
          const opts =
            f.optionsKey === 'branches' ? branchOptions : f.options ?? [];

          if (f.type === 'select') {
            return (
              <div key={f.name} className={span}>
                <Select
                  label={f.label}
                  value={String(form[f.name] ?? '')}
                  onChange={(e) => set(f.name, e.target.value)}
                >
                  <option value="">Seleccionar…</option>
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            );
          }

          if (f.type === 'textarea') {
            return (
              <label key={f.name} className={`${span} block`}>
                <span className="mb-1 block text-xs font-medium text-white/60">
                  {f.label}
                </span>
                <textarea
                  className="input-base min-h-[72px]"
                  value={String(form[f.name] ?? '')}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              </label>
            );
          }

          if (f.type === 'checkbox') {
            return (
              <label
                key={f.name}
                className={`${span} flex items-center gap-2 text-sm text-white/70`}
              >
                <input
                  type="checkbox"
                  checked={Boolean(form[f.name])}
                  onChange={(e) => set(f.name, e.target.checked)}
                  className="rounded border-white/20 bg-ink-800 text-gold-400 focus:ring-gold/40"
                />
                {f.label}
              </label>
            );
          }

          if (f.type === 'color') {
            const val = String(form[f.name] ?? '') || '#F59E0B';
            return (
              <div key={f.name} className={span}>
                <span className="mb-1 block text-xs font-medium text-white/60">
                  {f.label}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={val}
                    onChange={(e) => set(f.name, e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-lg border border-white/10 bg-ink-800 p-1"
                  />
                  <span className="text-sm text-white/50">{val.toUpperCase()}</span>
                </div>
              </div>
            );
          }

          return (
            <div key={f.name} className={span}>
              <Input
                label={f.label}
                type={f.type === 'date' ? 'date' : f.type === 'text' ? 'text' : 'number'}
                step={f.type === 'money' ? '0.01' : undefined}
                min={f.type === 'number' || f.type === 'money' ? '0' : undefined}
                placeholder={f.placeholder}
                value={String(form[f.name] ?? '')}
                onChange={(e) => set(f.name, e.target.value)}
              />
            </div>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-5 flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          loading={save.isPending}
          onClick={() => {
            setError('');
            save.mutate();
          }}
        >
          {isEdit ? 'Guardar cambios' : 'Crear'}
        </Button>
      </div>
    </Modal>
  );
}

function IconBtn({
  icon: Icon,
  title,
  onClick,
  danger,
}: {
  icon: typeof Pencil;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-lg p-1.5 text-white/50 hover:bg-white/10 ${
        danger ? 'hover:text-danger' : 'hover:text-white'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
