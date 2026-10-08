import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  UserPlus,
  Search,
  Trash2,
  Plus,
  Palette,
  Scissors,
  TriangleAlert,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  UserCheck,
  Wallet,
  Save,
  Merge,
  CopyCheck,
} from 'lucide-react';
import { batch, query, queryOne, execute } from '@/lib/db';
import { invalidateCustomers } from '@/lib/queryClient';
import {
  CustomerFields,
  EMPTY_CUSTOMER_DRAFT,
  type CustomerDraft,
} from './CustomerFields';
import {
  genId,
  money,
  dateShort,
  timeShort,
  customerName,
  fullName,
  todayISO,
  toLocalNaive,
} from '@/lib/format';
import { customerHaystack } from './customerSearch';
import { useOrgId, useSession } from '@/store/session';
import { useStaff } from '@/features/pos/useCatalog';
import {
  Card,
  CardHeader,
  StatCard,
  Button,
  DateInput,
  Input,
  Select,
  Modal,
  Badge,
  EmptyState,
  useToast,
  PageHeader,
} from '@/components/ui';
import { ROUTES } from '@/config/constants';
import { phoneToWaDigits, validatePhone } from '@/lib/phone';
import { normalizeEmail, validateEmail } from '@/lib/email';
import { findCustomerByPhone } from './customerLookup';
import { DuplicatePhoneNotice } from './DuplicatePhoneNotice';
import type { Customer, CustomerColorRecord } from '@/types';
import {
  duplicateGroups,
  fillCustomerGaps,
  gapFillSummary,
  phonelessCandidates,
  renamedName,
  type CustomerPatch,
} from './mergeCustomers';
import {
  DuplicatesModal,
  MergeClientsModal,
  MergePickerModal,
} from './MergeClientsModal';

/* ═══════════════════════════ Lista de clientes ═══════════════════════════ */

interface ClientRow extends Customer {
  visits: number;
  spent: number;
  last_visit: string | null;
}

type WaFilter = 'all' | 'with' | 'without';
type StatusFilter = 'all' | 'buyers' | 'new';
type SortKey = 'name' | 'spent' | 'visits' | 'recent';
const PAGE_SIZES = [25, 50, 100];

export function ClientsPage() {
  const orgId = useOrgId();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [wa, setWa] = useState<WaFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [dupsOpen, setDupsOpen] = useState(false);

  const clients = useQuery({
    queryKey: ['clients', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<ClientRow>(
        // Antes eran 3 subconsultas correlacionadas (una por COUNT/SUM/MAX),
        // o sea 3 búsquedas en `sale` por cada cliente. Un solo LEFT JOIN +
        // GROUP BY calcula las tres en la misma pasada.
        `SELECT c.*,
                COUNT(s.id) AS visits,
                COALESCE(SUM(s.total), 0) AS spent,
                MAX(s.sold_at) AS last_visit
           FROM customer c
           LEFT JOIN sale s
             ON s.customer_id = c.id
            AND s.status IN ('completed','partially_refunded')
          WHERE c.organization_id = ? AND c.active = 1
          GROUP BY c.id`,
        [orgId],
      ),
  });

  // Referencia estable: `?? []` daría un array nuevo en cada render mientras
  // la query carga y recalcularía los useMemo de abajo (incluida la detección de
  // duplicados, que recorre toda la libreta).
  const all = useMemo(() => clients.data ?? [], [clients.data]);

  const stats = useMemo(() => {
    const withWa = all.filter((c) => !!c.phone).length;
    const buyers = all.filter((c) => c.visits > 0).length;
    const revenue = all.reduce((s, c) => s + (c.spent || 0), 0);
    return { total: all.length, withWa, buyers, revenue };
  }, [all]);

  // Grupos de contactos que parecen la misma persona (nombre/WhatsApp/email).
  const dupGroups = useMemo(() => duplicateGroups(all), [all]);
  // Fichas que sobran: un grupo de 3 son 2 duplicados, no 1.
  const dupCount = useMemo(
    () => dupGroups.reduce((n, g) => n + g.length - 1, 0),
    [dupGroups],
  );
  // Contactos sin WhatsApp con un posible dueño (mismo nombre de pila, sin
  // ambigüedad). Aparte de `dupGroups`: es un indicio más débil, no una
  // detección segura, y mezclarlo le bajaría la confianza a los otros.
  const phonelessMatches = useMemo(() => phonelessCandidates(all), [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = all.filter((c) => {
      if (wa === 'with' && !c.phone) return false;
      if (wa === 'without' && c.phone) return false;
      if (status === 'buyers' && c.visits === 0) return false;
      if (status === 'new' && c.visits > 0) return false;
      if (!q) return true;
      // Alias y nombre de la agenda incluidos: después de normalizar los
      // nombres para facturar, buscar "Mica" tiene que seguir encontrándola.
      return customerHaystack(c).includes(q);
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'spent':
          return b.spent - a.spent;
        case 'visits':
          return b.visits - a.visits;
        case 'recent':
          return (b.last_visit ?? '').localeCompare(a.last_visit ?? '');
        default:
          return customerName(a).localeCompare(customerName(b));
      }
    });
    return list;
  }, [all, search, wa, status, sort]);

  /**
   * Cambiar un filtro vuelve a la primera página: quedarse en la 3 mostraría un
   * tramo arbitrario del resultado nuevo. Se hace en el propio setter y no en un
   * efecto para no encadenar un render extra en cada tecla del buscador.
   */
  const onFilterChange = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Clientes</h1>
          <p className="text-sm text-white/40">
            {stats.total.toLocaleString('es-EC')} en total
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dupCount + phonelessMatches.length > 0 && (
            <Button variant="ghost" onClick={() => setDupsOpen(true)}>
              <CopyCheck className="h-4 w-4" />
              {dupCount + phonelessMatches.length} posible
              {dupCount + phonelessMatches.length > 1 ? 's' : ''} duplicado
              {dupCount + phonelessMatches.length > 1 ? 's' : ''}
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4" /> Nuevo cliente
          </Button>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Clientes"
          value={stats.total.toLocaleString('es-EC')}
          icon={Users}
        />
        <StatCard
          label="Con WhatsApp"
          value={stats.withWa.toLocaleString('es-EC')}
          icon={MessageCircle}
          hint={
            stats.total
              ? `${Math.round((stats.withWa / stats.total) * 100)}% del total`
              : undefined
          }
        />
        <StatCard
          label="Con compras"
          value={stats.buyers.toLocaleString('es-EC')}
          icon={UserCheck}
        />
        <StatCard
          label="Facturado"
          value={money(stats.revenue)}
          icon={Wallet}
          tone="gold"
        />
      </div>

      <Card className="space-y-4">
        {/* Filtros */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              value={search}
              onChange={(e) => onFilterChange(setSearch)(e.target.value)}
              placeholder="Buscar por nombre, WhatsApp o email…"
              className="input-base w-full pl-9"
            />
          </div>
          <div className="grid grid-cols-3 gap-2 lg:flex lg:w-auto">
            <Select
              value={wa}
              onChange={(e) => onFilterChange(setWa)(e.target.value as WaFilter)}
            >
              <option value="all">WhatsApp: todos</option>
              <option value="with">Con WhatsApp</option>
              <option value="without">Sin WhatsApp</option>
            </Select>
            <Select
              value={status}
              onChange={(e) => onFilterChange(setStatus)(e.target.value as StatusFilter)}
            >
              <option value="all">Actividad: todos</option>
              <option value="buyers">Con compras</option>
              <option value="new">Nuevos (0)</option>
            </Select>
            <Select
              value={sort}
              onChange={(e) => onFilterChange(setSort)(e.target.value as SortKey)}
            >
              <option value="name">Orden: nombre</option>
              <option value="spent">Más gastan</option>
              <option value="visits">Más visitas</option>
              <option value="recent">Recientes</option>
            </Select>
          </div>
        </div>

        {filtered.length > 0 ? (
          <>
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/40">
                    <th className="px-4 py-2.5 font-medium">Cliente</th>
                    <th className="px-4 py-2.5 font-medium">WhatsApp</th>
                    <th className="px-4 py-2.5 text-center font-medium">
                      Visitas
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Total gastado
                    </th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">
                      Última visita
                    </th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`${ROUTES.client}/${c.id}`)}
                      className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar
                            first={c.first_name}
                            last={c.last_name}
                          />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 truncate font-medium text-white">
                              {customerName(c)}
                              {c.allergies && (
                                <TriangleAlert
                                  className="h-3.5 w-3.5 shrink-0 text-danger"
                                  aria-label="Alergias"
                                />
                              )}
                            </p>
                            {c.email && (
                              <p className="truncate text-xs text-white/40">
                                {c.email}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white/70">
                        {c.phone || (
                          <span className="text-white/25">Sin WhatsApp</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {c.visits > 0 ? (
                          <Badge tone="info">{c.visits}</Badge>
                        ) : (
                          <span className="text-white/25">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gold-200">
                        {money(c.spent)}
                      </td>
                      <td className="hidden px-4 py-3 text-white/50 md:table-cell">
                        {c.last_visit ? dateShort(c.last_visit) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {c.phone && (
                          <a
                            href={waLink(c.phone)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Abrir WhatsApp"
                            className="inline-flex rounded-lg p-1.5 text-success/80 hover:bg-success/10 hover:text-success"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            <div className="flex flex-col items-center justify-between gap-3 pt-1 text-sm text-white/50 sm:flex-row">
              <div className="flex items-center gap-2">
                <span>
                  {start + 1}–{Math.min(start + pageSize, filtered.length)} de{' '}
                  {filtered.length.toLocaleString('es-EC')}
                </span>
                <select
                  value={pageSize}
                  onChange={(e) => onFilterChange(setPageSize)(Number(e.target.value))}
                  className="input-base h-8 py-0 text-xs"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n} / pág.
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <PagerBtn
                  onClick={() => setPage(1)}
                  disabled={current === 1}
                  icon={ChevronsLeft}
                />
                <PagerBtn
                  onClick={() => setPage(current - 1)}
                  disabled={current === 1}
                  icon={ChevronLeft}
                />
                <span className="px-2 text-white/70">
                  {current} / {totalPages}
                </span>
                <PagerBtn
                  onClick={() => setPage(current + 1)}
                  disabled={current === totalPages}
                  icon={ChevronRight}
                />
                <PagerBtn
                  onClick={() => setPage(totalPages)}
                  disabled={current === totalPages}
                  icon={ChevronsRight}
                />
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={Users}
            title={all.length ? 'Sin resultados' : 'Sin clientes'}
            description={
              all.length
                ? 'Probá ajustar la búsqueda o los filtros.'
                : 'Creá tu primer cliente para empezar la ficha.'
            }
          />
        )}
      </Card>

      <CreateClientModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      <DuplicatesModal
        open={dupsOpen}
        onClose={() => setDupsOpen(false)}
        groups={dupGroups}
        candidates={phonelessMatches}
      />
    </div>
  );
}

/* ─── avatar de iniciales ─── */
const AVATAR_TONES = [
  'bg-gold/20 text-gold-200',
  'bg-info/20 text-info',
  'bg-success/20 text-success',
  'bg-fuchsia-500/20 text-fuchsia-300',
  'bg-sky-500/20 text-sky-300',
  'bg-amber-500/20 text-amber-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-rose-500/20 text-rose-300',
];

function Avatar({
  first,
  last,
}: {
  first: string;
  last: string | null;
}) {
  const initials =
    ((first?.[0] ?? '') + (last?.[0] ?? first?.[1] ?? '')).toUpperCase() || '?';
  let hash = 0;
  const key = first + (last ?? '');
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const tone = AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${tone}`}
    >
      {initials}
    </span>
  );
}

function PagerBtn({
  onClick,
  disabled,
  icon: Icon,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: typeof ChevronLeft;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** Enlace wa.me desde el teléfono canónico. */
function waLink(phone: string): string {
  return `https://wa.me/${phoneToWaDigits(phone)}`;
}

function CreateClientModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const [draft, setDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER_DRAFT);
  /** Ficha que ya tiene ese número (si aparece, no hay que crear otra). */
  const [owner, setOwner] = useState<Customer | null>(null);

  const set = <K extends keyof CustomerDraft>(
    key: K,
    value: CustomerDraft[K],
  ) => {
    // Tocar el teléfono descarta el aviso de duplicado: ya no aplica al número
    // que se está escribiendo.
    if (key === 'phone') setOwner(null);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  /** Lo escrito en el formulario, en la forma en que se guarda. */
  const patch: CustomerPatch = {
    first_name: draft.firstName.trim(),
    last_name: draft.lastName.trim() || null,
    nickname: draft.nickname.trim() || null,
    imported_name: draft.importedName.trim() || null,
    phone: draft.phone.trim() || null,
    email: normalizeEmail(draft.email) || null,
    birth_date: draft.birth || null,
    tax_id: draft.taxId.trim() || null,
  };

  /** Nombre que quedaría en la ficha existente si se la usa (null: no cambia). */
  const renameTo = owner ? renamedName(owner, patch) : null;

  const close = () => {
    setDraft(EMPTY_CUSTOMER_DRAFT);
    setOwner(null);
    onClose();
  };

  const save = useMutation({
    mutationFn: async () => {
      const canonical = draft.phone.trim() || null;
      const phoneError = validatePhone(canonical);
      if (phoneError) throw new Error(phoneError);
      const email = normalizeEmail(draft.email);
      const emailError = validateEmail(email);
      if (emailError) throw new Error(emailError);
      if (canonical) {
        const hit = await findCustomerByPhone(orgId, canonical);
        if (hit) {
          const err = new Error(
            `Ese número ya es de ${customerName(hit)}.`,
          ) as Error & { hit?: Customer };
          err.hit = hit;
          throw err;
        }
      }
      const id = genId();
      await execute(
        `INSERT INTO customer
           (id, organization_id, first_name, last_name, nickname, imported_name,
            phone, email, birth_date, tax_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          orgId,
          draft.firstName.trim(),
          draft.lastName.trim() || null,
          draft.nickname.trim() || null,
          draft.importedName.trim() || null,
          canonical,
          email || null,
          draft.birth || null,
          draft.taxId.trim() || null,
        ],
      );
      return id;
    },
    onError: (e: Error & { hit?: Customer }) => {
      if (e.hit) {
        setOwner(e.hit);
        toast.error('Ese WhatsApp ya está en otra ficha', e.message);
      } else {
        toast.error('No se pudo crear el cliente', e.message);
      }
    },
    onSuccess: (id) => {
      invalidateCustomers(qc, orgId);
      toast.success(
        'Cliente creado',
        customerName({
          first_name: draft.firstName.trim(),
          last_name: draft.lastName.trim() || null,
          nickname: draft.nickname.trim() || null,
        }),
      );
      close();
      navigate(`${ROUTES.client}/${id}`);
    },
  });

  /**
   * El número ya tiene ficha: en vez de hacerle borrar todo y buscar a mano, se
   * abre esa ficha y se le completan los campos que estaban vacíos con lo que se
   * acababa de escribir (email, cumpleaños, apellido). No se pisa nada.
   */
  const useExisting = useMutation({
    mutationFn: async () => {
      if (!owner) return null;
      const gap = fillCustomerGaps(owner, patch);
      if (gap) await batch([gap.stmt]);
      return gap;
    },
    onSuccess: (gap) => {
      const id = owner!.id;
      invalidateCustomers(qc, orgId);
      void qc.invalidateQueries({ queryKey: ['client', id] });
      // Si se renombró, el nombre viejo ya no sirve para encontrar el aviso:
      // el título lleva el nuevo y el detalle dice cuál era.
      toast.success(
        `Ficha de ${gap?.renamedFrom ? renameTo : customerName(owner!)}`,
        gapFillSummary(gap),
      );
      close();
      navigate(`${ROUTES.client}/${id}`);
    },
    onError: (e: Error) =>
      toast.error('No se pudo usar ese contacto', e.message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Nuevo cliente">
      <div className="space-y-4">
        <CustomerFields
          draft={draft}
          set={set}
          notice={
            <DuplicatePhoneNotice
              owner={owner}
              renameTo={renameTo}
              busy={useExisting.isPending}
              onUse={() => useExisting.mutate()}
              onOpen={(id) => {
                close();
                navigate(`${ROUTES.client}/${id}`);
              }}
            />
          }
        />
        <Button
          className="w-full"
          disabled={!draft.firstName.trim()}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Crear y abrir ficha
        </Button>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════ Ficha del cliente ═══════════════════════════ */

interface HistoryRow {
  sale_id: string;
  description: string;
  quantity: number;
  final_unit_price: number;
  sold_at: string;
  is_color: number;
}

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const client = useQuery({
    queryKey: ['client', id],
    enabled: !!id,
    queryFn: () =>
      queryOne<Customer>('SELECT * FROM customer WHERE id = ?', [id]),
  });

  if (client.isLoading) return null;
  if (!client.data) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-6">
        <PageHeader onBack={() => navigate(ROUTES.clients)} title="Cliente" />
        <Card>
          <EmptyState icon={Users} title="Cliente no encontrado" />
        </Card>
      </div>
    );
  }

  return <ClientDetail customer={client.data} />;
}

/**
 * Detalle del cliente.
 *
 * Vive aparte de la página (y no dentro de la ficha) porque el borrador del
 * formulario está izado acá: el botón de regresar necesita saber si quedan
 * cambios sin guardar para poder ofrecer guardar o descartar antes de salir.
 */
function ClientDetail({ customer }: { customer: Customer }) {
  const id = customer.id;
  const orgId = customer.organization_id;
  const navigate = useNavigate();
  const [mergeOpen, setMergeOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmLeave, setConfirmLeave] = useState(false);

  const metrics = useQuery({
    queryKey: ['client-metrics', id],
    enabled: !!id,
    queryFn: () =>
      queryOne<{ visits: number; spent: number; last: string | null }>(
        `SELECT COUNT(*) AS visits, COALESCE(SUM(total),0) AS spent, MAX(sold_at) AS last
           FROM sale WHERE customer_id = ?
            AND status IN ('completed','partially_refunded')`,
        [id],
      ),
  });

  const history = useQuery({
    queryKey: ['client-history', id],
    enabled: !!id,
    queryFn: () =>
      query<HistoryRow>(
        `SELECT s.id AS sale_id, si.description, si.quantity, si.final_unit_price,
                s.sold_at,
                CASE WHEN sv.category = 'Color' THEN 1 ELSE 0 END AS is_color
           FROM sale s
           JOIN sale_item si ON si.sale_id = s.id
           LEFT JOIN service sv ON sv.id = si.service_id
          WHERE s.customer_id = ?
            AND si.service_id IS NOT NULL
            AND s.status IN ('completed','partially_refunded')
          ORDER BY s.sold_at DESC
          LIMIT 100`,
        [id],
      ),
  });

  const payments = useQuery({
    queryKey: ['client-payments', id],
    enabled: !!id,
    queryFn: () =>
      query<{
        id: string;
        amount: number;
        paid_at: string;
        reference: string | null;
        bank_name: string | null;
        method_type: string;
        created_by_name: string | null;
        sale_id: string | null;
        appointment_id: string | null;
      }>(
        `SELECT p.id, p.amount, p.paid_at, p.reference,
                pm.method_type, ba.name AS bank_name,
                u.full_name AS created_by_name,
                p.sale_id, COALESCE(p.appointment_id, s.appointment_id, a.id) AS appointment_id
           FROM payment p
           JOIN payment_method pm ON pm.id = p.payment_method_id
           LEFT JOIN bank_account ba ON ba.id = p.bank_account_id
           LEFT JOIN app_user u ON u.id = p.created_by
           LEFT JOIN sale s ON s.id = p.sale_id
           LEFT JOIN appointment a ON a.id = p.appointment_id
          WHERE p.status = 'confirmed'
            AND (s.customer_id = ? OR a.customer_id = ?)
          ORDER BY p.paid_at DESC
          LIMIT 200`,
        [id, id],
      ),
  });

  const upcoming = useQuery({
    queryKey: ['client-upcoming', id],
    enabled: !!id,
    queryFn: () =>
      query<{
        id: string;
        start_at: string;
        status: string;
        services: string | null;
      }>(
        `SELECT a.id, a.start_at, a.status,
                (SELECT GROUP_CONCAT(ai.description, ', ')
                   FROM appointment_item ai WHERE ai.appointment_id = a.id) AS services
           FROM appointment a
          WHERE a.customer_id = ? AND a.start_at >= ?
            AND a.status IN ('reserved','confirmed')
          ORDER BY a.start_at ASC LIMIT 10`,
        [id, toLocalNaive(new Date())],
      ),
  });

  const form = useClientDraft(customer, {
    onSaved: () => {
      void qc.invalidateQueries({ queryKey: ['client', id] });
      invalidateCustomers(qc, orgId);
      toast.success('Cambios guardados', 'La ficha del cliente quedó actualizada.');
    },
    onFail: (msg) => toast.error('No se pudo guardar', msg),
  });

  const goBack = () => navigate(ROUTES.clients);

  /** Guarda y sale; si el guardado falla nos quedamos para poder corregir. */
  const saveAndExit = async () => {
    try {
      await form.save.mutateAsync();
      goBack();
    } catch {
      setConfirmLeave(false);
    }
  };

  const handleBack = () => (form.dirty ? setConfirmLeave(true) : goBack());

  /**
   * Después de combinar: si la ficha que sobrevivió es otra, se abre esa; si es
   * esta, se espera el refetch y se relee el borrador (la fila cambió: quedaron
   * las notas de las dos fichas).
   */
  const afterMerge = async (keptId: string) => {
    if (keptId !== id) {
      navigate(`${ROUTES.client}/${keptId}`, { replace: true });
      return;
    }
    await qc.refetchQueries({ queryKey: ['client', id] });
    form.resync();
  };

  const c = customer;
  const m = metrics.data;
  const visits = m?.visits ?? 0;
  const spent = m?.spent ?? 0;
  const avg = visits > 0 ? spent / visits : 0;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader
        onBack={handleBack}
        title={customerName(c)}
        right={
          <div className="flex items-center gap-2">
            {c.allergies && (
              <Badge tone="danger">
                <TriangleAlert className="mr-1 inline h-3 w-3" /> Alergias
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMergeOpen(true)}
              disabled={form.dirty}
              title={
                form.dirty
                  ? 'Guardá o descartá los cambios antes de combinar'
                  : 'Combinar con un contacto duplicado'
              }
            >
              <Merge className="h-4 w-4" /> Combinar
            </Button>
          </div>
        }
      />

      <MergePickerModal
        open={mergeOpen}
        customer={c}
        onClose={() => setMergeOpen(false)}
        onMerged={(keptId) => void afterMerge(keptId)}
      />

      {/* Combinar con la ficha que ya tiene el WhatsApp que se intentó guardar:
          se abre desde el aviso del formulario, con los cambios sin guardar
          incluidos (`patch`). */}
      {form.combineOpen && form.owner && (
        <MergeClientsModal
          open
          a={c}
          b={form.owner}
          patches={{ [c.id]: form.patch }}
          hint="Lo que escribiste en la ficha (incluido el WhatsApp) se guarda en el contacto que quede."
          onClose={() => form.setCombineOpen(false)}
          onMerged={(keptId) => {
            form.setCombineOpen(false);
            form.setOwner(null);
            void afterMerge(keptId);
          }}
        />
      )}

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Total gastado" value={money(spent)} gold />
        <Metric label="Visitas" value={String(visits)} />
        <Metric label="Ticket promedio" value={money(avg)} />
        <Metric
          label="Última visita"
          value={m?.last ? dateShort(m.last) : '—'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Próximas citas */}
          {upcoming.data && upcoming.data.length > 0 && (
            <Card>
              <CardHeader
                title="Próximas citas"
                subtitle="Reservas futuras de este cliente"
              />
              <ul className="divide-y divide-white/5">
                {upcoming.data.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => navigate(`${ROUTES.appointment}/${a.id}`)}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-white/[0.02]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white/90">
                          {a.services ?? 'Sin servicios'}
                        </p>
                        <p className="text-xs text-white/40">
                          {dateShort(a.start_at)} · {timeShort(a.start_at)}
                        </p>
                      </div>
                      <Badge tone={a.status === 'confirmed' ? 'gold' : 'info'}>
                        {a.status === 'confirmed' ? 'Confirmada' : 'Reservada'}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <ColorRecordsCard customerId={id} />

          {/* Historial de pagos: todo cobro confirmado del cliente, abierto al
              detalle de la cita (una sola pantalla donde recibir reclamos). */}
          <Card>
            <CardHeader
              title="Pagos"
              subtitle="Cobros confirmados (más recientes primero)"
            />
            {payments.data && payments.data.length > 0 ? (
              <ul className="divide-y divide-white/5">
                {payments.data.map((p) => {
                  const target = p.appointment_id
                    ? `${ROUTES.appointment}/${p.appointment_id}`
                    : null;
                  const content = (
                    <div className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-white/90">
                          <span className="font-semibold text-white">
                            {money(p.amount)}
                          </span>{' '}
                          · {p.bank_name ?? 'Efectivo'}
                          {p.reference ? ` · ${p.reference}` : ''}
                        </p>
                        <p className="text-xs text-white/40">
                          {dateShort(p.paid_at)} · {timeShort(p.paid_at)}
                          {p.created_by_name
                            ? ` · ${p.created_by_name}`
                            : ''}
                        </p>
                      </div>
                      <Badge
                        tone={p.sale_id ? 'success' : 'info'}
                      >
                        {p.sale_id ? 'Pago' : 'Abono'}
                      </Badge>
                    </div>
                  );
                  return (
                    <li key={p.id}>
                      {target ? (
                        <button
                          onClick={() => navigate(target)}
                          className="w-full text-left hover:bg-white/[0.02]"
                        >
                          {content}
                        </button>
                      ) : (
                        content
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={Wallet}
                title="Sin pagos"
                description="Todavía no se registraron cobros a este cliente."
              />
            )}
          </Card>

          {/* Historial de servicios */}
          <Card>
            <CardHeader
              title="Historial de servicios"
              subtitle="Servicios contratados (más recientes primero)"
            />
            {history.data && history.data.length > 0 ? (
              <ul className="divide-y divide-white/5">
                {history.data.map((h, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white/90">
                        {h.is_color ? (
                          <Palette className="mr-1 inline h-3.5 w-3.5 text-gold-300" />
                        ) : null}
                        {h.description}
                      </p>
                      <p className="text-xs text-white/40">
                        {dateShort(h.sold_at)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-white">
                      {money(h.final_unit_price * h.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Scissors}
                title="Sin historial"
                description="Aún no hay servicios facturados a este cliente."
              />
            )}
          </Card>
        </div>

        {/* Ficha editable */}
        <div className="lg:col-span-1">
          <ClientForm
            form={form}
            onSave={() => void saveAndExit()}
            onCancel={goBack}
          />
        </div>
      </div>

      {/* Salida con cambios pendientes: guardar o descartar, nunca perder
          los datos en silencio. */}
      <Modal
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Cambios sin guardar"
        className="sm:max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-white/70">
            La ficha de <b className="text-white">{customerName(c)}</b>{' '}
            tiene cambios que todavía no se guardaron.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              className="sm:order-2"
              loading={form.save.isPending}
              onClick={() => void saveAndExit()}
            >
              <Save className="h-4 w-4" /> Guardar cambios
            </Button>
            <Button
              variant="outline"
              className="sm:order-1"
              disabled={form.save.isPending}
              onClick={() => {
                setConfirmLeave(false);
                goBack();
              }}
            >
              Salir sin guardar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ──────────────────────── Borrador de la ficha ──────────────────────── */

interface ClientDraft extends CustomerDraft {
  preferred: string;
  notes: string;
  allergies: string;
  hairNotes: string;
}

function draftFromCustomer(c: Customer): ClientDraft {
  return {
    firstName: c.first_name,
    lastName: c.last_name ?? '',
    nickname: c.nickname ?? '',
    importedName: c.imported_name ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    birth: c.birth_date ?? '',
    taxId: c.tax_id ?? '',
    preferred: c.preferred_staff_id ?? '',
    notes: c.notes ?? '',
    allergies: c.allergies ?? '',
    hairNotes: c.hair_notes ?? '',
  };
}

type ClientDraftState = ReturnType<typeof useClientDraft>;

/**
 * Estado editable de la ficha + su guardado.
 *
 * `dirty` compara contra lo que hay en base (lo que devuelve la query), así
 * que después de guardar se apaga solo cuando llega el refetch: no hay que
 * sincronizar una copia "inicial" a mano.
 */
function useClientDraft(
  customer: Customer,
  { onSaved, onFail }: { onSaved: () => void; onFail: (msg: string) => void },
) {
  const stored = draftFromCustomer(customer);
  const [draft, setDraft] = useState(stored);
  /** Ficha que ya tiene el WhatsApp que se escribió. */
  const [owner, setOwner] = useState<Customer | null>(null);
  const [combineOpen, setCombineOpen] = useState(false);
  // Sube de a uno cuando hay que releer el borrador del mismo cliente (después
  // de combinar, la fila quedó con las notas de las dos fichas).
  const [syncToken, setSyncToken] = useState(0);
  const [loaded, setLoaded] = useState(`${customer.id}:0`);

  // Cambiar de cliente sin desmontar la pantalla (p. ej. abrir la ficha del
  // duplicado) tiene que traer el borrador del nuevo, no arrastrar el anterior.
  const token = `${customer.id}:${syncToken}`;
  if (loaded !== token) {
    setLoaded(token);
    setDraft(stored);
    setOwner(null);
  }

  const set = <K extends keyof ClientDraft>(key: K, value: ClientDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /** Lo escrito en el formulario, en la forma en que se guarda en la fila. */
  const patch: CustomerPatch = {
    first_name: draft.firstName.trim(),
    last_name: draft.lastName.trim() || null,
    nickname: draft.nickname.trim() || null,
    imported_name: draft.importedName.trim() || null,
    phone: draft.phone.trim() || null,
    email: normalizeEmail(draft.email) || null,
    birth_date: draft.birth || null,
    tax_id: draft.taxId.trim() || null,
    preferred_staff_id: draft.preferred || null,
    notes: draft.notes.trim() || null,
    allergies: draft.allergies.trim() || null,
    hair_notes: draft.hairNotes.trim() || null,
  };

  const dirty = (Object.keys(stored) as (keyof ClientDraft)[]).some(
    (k) => draft[k] !== stored[k],
  );

  const save = useMutation({
    mutationFn: async () => {
      const canonical = draft.phone.trim() || null;
      const phoneError = validatePhone(canonical);
      if (phoneError) throw new Error(phoneError);
      const email = normalizeEmail(draft.email);
      const emailError = validateEmail(email);
      if (emailError) throw new Error(emailError);
      if (canonical) {
        const hit = await findCustomerByPhone(
          customer.organization_id,
          canonical,
        );
        if (hit && hit.id !== customer.id) {
          const err = new Error(
            `Ese número ya es de ${customerName(hit)}.`,
          ) as Error & { hit?: Customer };
          err.hit = hit;
          throw err;
        }
      }
      return execute(
        `UPDATE customer SET
           first_name = ?, last_name = ?, nickname = ?, imported_name = ?,
           phone = ?, email = ?, birth_date = ?, tax_id = ?,
           preferred_staff_id = ?, notes = ?, allergies = ?, hair_notes = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          draft.firstName.trim(),
          draft.lastName.trim() || null,
          draft.nickname.trim() || null,
          draft.importedName.trim() || null,
          canonical,
          email || null,
          draft.birth || null,
          draft.taxId.trim() || null,
          draft.preferred || null,
          draft.notes.trim() || null,
          draft.allergies.trim() || null,
          draft.hairNotes.trim() || null,
          new Date().toISOString(),
          customer.id,
        ],
      );
    },
    onError: (e: Error & { hit?: Customer }) => {
      if (e.hit) setOwner(e.hit);
      onFail(e.message);
    },
    onSuccess: onSaved,
  });

  return {
    draft,
    set,
    dirty,
    patch,
    owner,
    setOwner,
    combineOpen,
    setCombineOpen,
    /** Relee el borrador desde la fila (después de combinar). */
    resync: () => setSyncToken((t) => t + 1),
    save,
  };
}

function ClientForm({
  form,
  onSave,
  onCancel,
}: {
  form: ClientDraftState;
  onSave: () => void;
  onCancel: () => void;
}) {
  const staff = useStaff();
  const navigate = useNavigate();
  const { draft, set, dirty, owner, setOwner, setCombineOpen, save } = form;

  return (
    <Card className="sticky top-4">
      <CardHeader title="Ficha" subtitle="Datos y notas del cliente" />
      <div className="space-y-3">
        <CustomerFields
          draft={draft}
          set={(key, value) => {
            if (key === 'phone') setOwner(null);
            set(key, value);
          }}
          notice={
            <DuplicatePhoneNotice
              owner={owner}
              // Hay dos fichas de la misma persona: combinarlas conserva el
              // historial de las dos y los datos recién escritos.
              onMerge={() => setCombineOpen(true)}
              onOpen={(id) => navigate(`${ROUTES.client}/${id}`)}
            />
          }
        />
        <Select
          label="Estilista preferido"
          value={draft.preferred}
          onChange={(e) => set('preferred', e.target.value)}
        >
          <option value="">Sin preferencia</option>
          {staff.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {fullName(s.first_name, s.last_name)}
            </option>
          ))}
        </Select>

        <TextArea
          label="Alergias / sensibilidades"
          value={draft.allergies}
          onChange={(v) => set('allergies', v)}
          placeholder="Ej. alergia a la parafenilendiamina (tintes)"
          danger
        />
        <TextArea
          label="Notas capilares"
          value={draft.hairNotes}
          onChange={(v) => set('hairNotes', v)}
          placeholder="Condición del cabello, historial químico, advertencias…"
        />
        <TextArea
          label="Notas generales"
          value={draft.notes}
          onChange={(v) => set('notes', v)}
          placeholder="Preferencias, observaciones…"
        />

        {/* Guardar y Cancelar salen los dos a la lista de clientes. Apilados:
            la columna de la ficha es angosta y en dos columnas el texto parte. */}
        <div className="space-y-2 pt-1">
          <Button
            className="w-full"
            disabled={!draft.firstName.trim() || !dirty}
            loading={save.isPending}
            onClick={onSave}
          >
            <Save className="h-4 w-4" /> Guardar cambios
          </Button>
          <Button
            variant="outline"
            className="w-full"
            disabled={save.isPending}
            onClick={onCancel}
          >
            Cancelar
          </Button>
          {dirty && (
            <p className="text-center text-xs text-gold-200/70">
              Hay cambios sin guardar.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────── Procesos de color ─────────────────────────── */

function ColorRecordsCard({ customerId }: { customerId: string }) {
  const orgId = useOrgId();
  const userId = useSession((s) => s.user?.id ?? null);
  const staff = useStaff();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const records = useQuery({
    queryKey: ['color-records', customerId],
    enabled: !!customerId,
    queryFn: () =>
      query<CustomerColorRecord>(
        `SELECT * FROM customer_color_record
          WHERE customer_id = ? ORDER BY record_date DESC, created_at DESC`,
        [customerId],
      ),
  });

  const [date, setDate] = useState(todayISO());
  const [formula, setFormula] = useState('');
  const [brand, setBrand] = useState('');
  const [developer, setDeveloper] = useState('');
  const [result, setResult] = useState('');
  const [notes, setNotes] = useState('');
  const [staffId, setStaffId] = useState('');

  const add = useMutation({
    mutationFn: () =>
      execute(
        `INSERT INTO customer_color_record
           (id, organization_id, customer_id, record_date, formula, brand,
            developer, result, notes, staff_member_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          genId(),
          orgId,
          customerId,
          date,
          formula.trim() || null,
          brand.trim() || null,
          developer.trim() || null,
          result.trim() || null,
          notes.trim() || null,
          staffId || null,
          userId,
        ],
      ),
    onSuccess: () => {
      setFormula('');
      setBrand('');
      setDeveloper('');
      setResult('');
      setNotes('');
      setStaffId('');
      setDate(todayISO());
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['color-records', customerId] });
      toast.success('Proceso de color registrado');
    },
    onError: (e: Error) => toast.error('No se pudo registrar', e.message),
  });

  const del = useMutation({
    mutationFn: (recId: string) =>
      execute('DELETE FROM customer_color_record WHERE id = ?', [recId]),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['color-records', customerId] });
      toast.info('Proceso de color eliminado');
    },
    onError: (e: Error) => toast.error('No se pudo eliminar', e.message),
  });

  const staffName = (sid: string | null) => {
    const s = staff.data?.find((x) => x.id === sid);
    return s ? fullName(s.first_name, s.last_name) : null;
  };

  return (
    <Card>
      <CardHeader
        title="Procesos de color"
        subtitle="Registro capilar: fórmulas, marcas y resultados"
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Registrar
          </Button>
        }
      />
      {records.data && records.data.length > 0 ? (
        <ul className="space-y-3">
          {records.data.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-3"
            >
              <div className="mb-1 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm font-medium text-gold-200">
                  <Palette className="h-4 w-4" />
                  {dateShort(r.record_date)}
                  {staffName(r.staff_member_id) && (
                    <span className="text-xs font-normal text-white/40">
                      · {staffName(r.staff_member_id)}
                    </span>
                  )}
                </p>
                <button
                  onClick={() => del.mutate(r.id)}
                  className="text-white/30 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {r.formula && (
                <p className="text-sm text-white/80">
                  <span className="text-white/40">Fórmula:</span> {r.formula}
                </p>
              )}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-white/50">
                {r.brand && <span>Marca: {r.brand}</span>}
                {r.developer && <span>Oxidante: {r.developer}</span>}
                {r.result && <span>Resultado: {r.result}</span>}
              </div>
              {r.notes && (
                <p className="mt-1 text-xs text-white/50">{r.notes}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Palette}
          title="Sin procesos de color"
          description="Registrá la fórmula y el resultado de cada color."
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Registrar color">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <DateInput
              label="Fecha"
              value={date}
              onChange={setDate}
              clearable={false}
            />
            <Select
              label="Estilista"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">Sin asignar</option>
              {staff.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {fullName(s.first_name, s.last_name)}
                </option>
              ))}
            </Select>
          </div>
          <TextArea
            label="Fórmula"
            value={formula}
            onChange={setFormula}
            placeholder="Ej. 7.1 + 60ml oxidante 20vol, 30 min"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Marca"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
            <Input
              label="Oxidante"
              value={developer}
              onChange={(e) => setDeveloper(e.target.value)}
              placeholder="10/20/30 vol"
            />
          </div>
          <Input
            label="Resultado"
            value={result}
            onChange={(e) => setResult(e.target.value)}
            placeholder="Tono obtenido"
          />
          <TextArea
            label="Notas"
            value={notes}
            onChange={setNotes}
            placeholder="Observaciones, reacción, próximos pasos…"
          />
          <Button
            className="w-full"
            loading={add.isPending}
            onClick={() => add.mutate()}
          >
            Guardar registro
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

/* ─────────────────────────────── Auxiliares ─────────────────────────────── */

function Metric({
  label,
  value,
  gold,
}: {
  label: string;
  value: string;
  gold?: boolean;
}) {
  return (
    <div className="glass-card p-4">
      <p className="text-xs text-white/40">{label}</p>
      <p className={gold ? 'kpi-gold mt-1 text-xl' : 'mt-1 text-xl text-white'}>
        {value}
      </p>
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  danger,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  danger?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-white/60">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className={
          danger
            ? 'input-base w-full resize-y border-danger/30'
            : 'input-base w-full resize-y'
        }
      />
    </label>
  );
}

