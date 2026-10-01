import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Merge, Search, TriangleAlert, ArrowRight, Users } from 'lucide-react';
import { dateShort, fullName } from '@/lib/format';
import { useCustomers } from '@/features/pos/useCatalog';
import { Badge, Button, EmptyState, Modal, useToast } from '@/components/ui';
import type { Customer } from '@/types';
import {
  completeness,
  customerRefCounts,
  discardedContact,
  duplicateGroups,
  mergeablePairs,
  mergeCustomers,
  mergedFields,
  tableLabel,
} from './mergeCustomers';

/* ═════════════════════════ Combinar dos contactos ═════════════════════════ */

interface MergeProps {
  open: boolean;
  a: Customer;
  b: Customer;
  onClose: () => void;
  /** Se llama con el id del contacto que quedó. */
  onMerged?: (keptId: string) => void;
}

function MergeClientsModal({ open, a, b, onClose, onMerged }: MergeProps) {
  const qc = useQueryClient();
  const toast = useToast();
  // Principal sugerido: la ficha más completa.
  const [keepId, setKeepId] = useState(
    completeness(a) >= completeness(b) ? a.id : b.id,
  );
  const keep = keepId === a.id ? a : b;
  const dup = keepId === a.id ? b : a;

  const refs = useQuery({
    queryKey: ['customer-refs', dup.id],
    enabled: open,
    queryFn: () => customerRefCounts(dup.id),
  });

  const result = useMemo(() => mergedFields(keep, dup), [keep, dup]);
  // Las notas se conservan juntas, pero el teléfono y el email del duplicado se
  // pierden: si no coinciden hay que decirlo antes de borrar la ficha.
  const discarded = useMemo(() => discardedContact(keep, dup), [keep, dup]);

  const merge = useMutation({
    mutationFn: () => mergeCustomers(keep, dup),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast.success(
        'Contactos combinados',
        `Quedó una sola ficha de ${fullName(keep.first_name, keep.last_name)}.`,
      );
      onClose();
      onMerged?.(keep.id);
    },
    onError: (e: Error) => toast.error('No se pudo combinar', e.message),
  });

  const moving = refs.data ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Combinar contactos"
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <p className="text-sm text-white/50">
          Elegí cuál queda como ficha principal. Todo lo del otro contacto
          (citas, ventas, fichas de color) se mueve a la principal y la ficha
          duplicada se elimina.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {[a, b].map((c) => (
            <CandidateCard
              key={c.id}
              customer={c}
              selected={c.id === keepId}
              onSelect={() => setKeepId(c.id)}
            />
          ))}
        </div>

        {/* Qué se mueve */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-white/40">
            <ArrowRight className="h-3.5 w-3.5" /> Se mueve a{' '}
            {fullName(keep.first_name, keep.last_name)}
          </p>
          {refs.isLoading ? (
            <p className="text-sm text-white/40">Calculando…</p>
          ) : moving.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {moving.map((r) => (
                <Badge key={r.table} tone="info">
                  {tableLabel(r.table, r.count)}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-white/40">
              El duplicado no tiene citas ni ventas: solo se elimina la ficha.
            </p>
          )}
        </div>

        {/* Resultado */}
        <div className="rounded-xl border border-gold/20 bg-gold/[0.06] p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gold-200/70">
            Ficha resultante
          </p>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <Field label="Nombre" value={fullName(result.first_name, result.last_name)} />
            <Field label="WhatsApp" value={result.phone} />
            <Field label="Email" value={result.email} />
            <Field
              label="Cumpleaños"
              value={result.birth_date ? dateShort(result.birth_date) : null}
            />
          </dl>
          {(result.notes || result.allergies || result.hair_notes) && (
            <p className="mt-2 text-xs text-white/40">
              Las notas de ambas fichas se conservan juntas.
            </p>
          )}
        </div>

        {discarded.length > 0 && (
          <div className="flex gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                Estos datos de la ficha duplicada se van a perder:
              </p>
              <ul className="mt-1 space-y-0.5 text-danger/85">
                {discarded.includes('phone') && <li>WhatsApp {dup.phone}</li>}
                {discarded.includes('email') && <li>Email {dup.email}</li>}
              </ul>
              <p className="mt-1 text-xs text-danger/70">
                Si son dos personas distintas, cancelá y no combines.
              </p>
            </div>
          </div>
        )}

        {merge.isError && (
          <p className="flex items-center gap-2 text-sm text-danger">
            <TriangleAlert className="h-4 w-4" />
            {merge.error.message}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            className="w-full sm:w-auto"
            loading={merge.isPending}
            onClick={() => merge.mutate()}
          >
            <Merge className="h-4 w-4" /> Combinar y eliminar duplicado
          </Button>
          <Button
            variant="ghost"
            className="w-full sm:w-auto"
            onClick={onClose}
            disabled={merge.isPending}
          >
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CandidateCard({
  customer,
  selected,
  onSelect,
}: {
  customer: Customer;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        selected
          ? 'rounded-xl border border-gold/50 bg-gold/10 p-3 text-left ring-1 ring-gold/30'
          : 'rounded-xl border border-white/10 bg-white/[0.02] p-3 text-left hover:bg-white/[0.05]'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-medium text-white">
          {fullName(customer.first_name, customer.last_name)}
        </p>
        {selected ? (
          <Badge tone="gold">Principal</Badge>
        ) : (
          <span className="shrink-0 text-xs text-white/35">Se elimina</span>
        )}
      </div>
      <p className="mt-1 truncate text-xs text-white/50">
        {customer.phone || 'Sin WhatsApp'}
      </p>
      <p className="truncate text-xs text-white/40">
        {customer.email || 'Sin email'}
      </p>
      <p className="mt-1 text-[11px] text-white/30">
        Creada {dateShort(customer.created_at)}
      </p>
    </button>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-white/40">{label}:</dt>
      <dd className="min-w-0 truncate text-white/90">{value || '—'}</dd>
    </div>
  );
}

/* ═══════════════════ Duplicados detectados (lista completa) ═══════════════ */

export function DuplicatesModal({
  open,
  onClose,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  /** Grupos ya detectados por el llamador (la lista los necesita para el contador). */
  groups: Customer[][];
}) {
  const [pair, setPair] = useState<[Customer, Customer] | null>(null);

  return (
    <>
      <Modal
        open={open && !pair}
        onClose={onClose}
        title="Posibles duplicados"
        className="max-w-2xl"
      >
        {groups.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-white/50">
              Contactos que parecen la misma persona (mismo nombre, WhatsApp o
              email). Revisá cada par antes de combinar.
            </p>
            {groups.map((g) => (
              <div
                key={g[0].id}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-3"
              >
                <ul className="space-y-1.5">
                  {g.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      <span className="truncate font-medium text-white">
                        {fullName(c.first_name, c.last_name)}
                      </span>
                      <span className="truncate text-xs text-white/40">
                        {c.phone || c.email || 'sin contacto'}
                      </span>
                    </li>
                  ))}
                </ul>
                <GroupActions group={g} onPick={setPair} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="Sin duplicados"
            description="No encontramos contactos repetidos por nombre, WhatsApp ni email."
          />
        )}
      </Modal>

      {pair && (
        <MergeClientsModal
          open
          a={pair[0]}
          b={pair[1]}
          onClose={() => setPair(null)}
        />
      )}
    </>
  );
}

/**
 * Cómo se nombra una ficha cuando hay que distinguirla de otra homónima: el
 * nombre no alcanza, lo que las diferencia es el dato de contacto.
 */
const describe = (c: Customer): string =>
  `${fullName(c.first_name, c.last_name)} · ${c.phone || c.email || 'sin contacto'}`;

/**
 * Botones de combinación de un grupo. Solo se ofrecen los pares sin datos de
 * contacto contradictorios: el agrupado es transitivo, así que una ficha sin
 * teléfono puede haber unido a dos personas con números distintos.
 */
function GroupActions({
  group,
  onPick,
}: {
  group: Customer[];
  onPick: (pair: [Customer, Customer]) => void;
}) {
  const pairs = mergeablePairs(group);
  if (pairs.length === 0) {
    return (
      <p className="mt-2 text-xs text-white/40">
        Tienen WhatsApp o email distintos: revisá si de verdad son la misma
        persona y combinalas desde la ficha.
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {pairs.map(([x, y]) => (
        <Button
          key={`${x.id}-${y.id}`}
          variant="ghost"
          className="text-xs"
          onClick={() => onPick([x, y])}
        >
          <Merge className="h-3.5 w-3.5" />
          {group.length > 2 ? `Combinar ${describe(x)} ↔ ${describe(y)}` : 'Combinar'}
        </Button>
      ))}
    </div>
  );
}

/* ═════════════ Buscar con quién combinar (desde la ficha) ═════════════ */

export function MergePickerModal({
  open,
  customer,
  onClose,
  onMerged,
}: {
  open: boolean;
  customer: Customer;
  onClose: () => void;
  onMerged?: (keptId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<Customer | null>(null);
  const others = useCustomers();

  const all = useMemo(
    () => (others.data ?? []).filter((c) => c.id !== customer.id),
    [others.data, customer.id],
  );

  // Detectar duplicados recorre toda la libreta: se calcula una sola vez y no
  // en cada tecla, que además solo usa el filtro por texto.
  const suggested = useMemo(
    () =>
      duplicateGroups([customer, ...all])
        .find((g) => g.some((c) => c.id === customer.id))
        ?.filter((c) => c.id !== customer.id) ?? [],
    [customer, all],
  );

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suggested.slice(0, 20);
    return all
      .filter((c) =>
        `${fullName(c.first_name, c.last_name)} ${c.phone ?? ''} ${c.email ?? ''}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 20);
  }, [all, suggested, search]);

  return (
    <>
      <Modal
        open={open && !target}
        onClose={onClose}
        title="Combinar con otro contacto"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar el contacto duplicado…"
              className="input-base w-full pl-9"
            />
          </div>
          {!search.trim() && list.length > 0 && (
            <p className="text-xs text-white/40">
              Coincidencias por nombre, WhatsApp o email:
            </p>
          )}
          {list.length > 0 ? (
            <ul className="divide-y divide-white/5">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setTarget(c)}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white/90">
                        {fullName(c.first_name, c.last_name)}
                      </p>
                      <p className="truncate text-xs text-white/40">
                        {c.phone || c.email || 'Sin contacto'}
                      </p>
                    </div>
                    <Merge className="h-4 w-4 shrink-0 text-white/30" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-white/40">
              {search.trim()
                ? 'Sin resultados.'
                : 'No detectamos duplicados de este contacto. Buscalo por nombre.'}
            </p>
          )}
        </div>
      </Modal>

      {target && (
        <MergeClientsModal
          open
          a={customer}
          b={target}
          onClose={() => {
            setTarget(null);
            onClose();
          }}
          onMerged={onMerged}
        />
      )}
    </>
  );
}
