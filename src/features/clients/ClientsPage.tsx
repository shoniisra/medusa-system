import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  UserPlus,
  Search,
  ArrowLeft,
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
} from 'lucide-react';
import { query, queryOne, execute } from '@/lib/db';
import {
  genId,
  money,
  dateShort,
  timeShort,
  fullName,
  todayISO,
  toLocalNaive,
} from '@/lib/format';
import { useOrgId, useSession } from '@/store/session';
import { useStaff } from '@/features/pos/useCatalog';
import {
  Card,
  CardHeader,
  StatCard,
  Button,
  Input,
  Select,
  Modal,
  Badge,
  EmptyState,
  PhoneInput,
} from '@/components/ui';
import { ROUTES } from '@/config/constants';
import { phoneToWaDigits } from '@/lib/phone';
import { findCustomerByPhone } from './customerLookup';
import type { Customer, CustomerColorRecord } from '@/types';

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

  const clients = useQuery({
    queryKey: ['clients', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<ClientRow>(
        `SELECT c.*,
                (SELECT COUNT(*) FROM sale s
                  WHERE s.customer_id = c.id
                    AND s.status IN ('completed','partially_refunded')) AS visits,
                (SELECT COALESCE(SUM(total),0) FROM sale s
                  WHERE s.customer_id = c.id
                    AND s.status IN ('completed','partially_refunded')) AS spent,
                (SELECT MAX(sold_at) FROM sale s
                  WHERE s.customer_id = c.id
                    AND s.status IN ('completed','partially_refunded')) AS last_visit
           FROM customer c
          WHERE c.organization_id = ? AND c.active = 1`,
        [orgId],
      ),
  });

  const all = clients.data ?? [];

  const stats = useMemo(() => {
    const withWa = all.filter((c) => !!c.phone).length;
    const buyers = all.filter((c) => c.visits > 0).length;
    const revenue = all.reduce((s, c) => s + (c.spent || 0), 0);
    return { total: all.length, withWa, buyers, revenue };
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = all.filter((c) => {
      if (wa === 'with' && !c.phone) return false;
      if (wa === 'without' && c.phone) return false;
      if (status === 'buyers' && c.visits === 0) return false;
      if (status === 'new' && c.visits > 0) return false;
      if (!q) return true;
      return (
        fullName(c.first_name, c.last_name).toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      );
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
          return fullName(a.first_name, a.last_name).localeCompare(
            fullName(b.first_name, b.last_name),
          );
      }
    });
    return list;
  }, [all, search, wa, status, sort]);

  // Reset a la primera página cuando cambian filtros
  useEffect(() => setPage(1), [search, wa, status, sort, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Clientes</h1>
          <p className="text-sm text-white/40">
            {stats.total.toLocaleString('es-EC')} en total
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4" /> Nuevo cliente
        </Button>
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
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, WhatsApp o email…"
              className="input-base w-full pl-9"
            />
          </div>
          <div className="grid grid-cols-3 gap-2 lg:flex lg:w-auto">
            <Select
              value={wa}
              onChange={(e) => setWa(e.target.value as WaFilter)}
            >
              <option value="all">WhatsApp: todos</option>
              <option value="with">Con WhatsApp</option>
              <option value="without">Sin WhatsApp</option>
            </Select>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="all">Actividad: todos</option>
              <option value="buyers">Con compras</option>
              <option value="new">Nuevos (0)</option>
            </Select>
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
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
                              {fullName(c.first_name, c.last_name)}
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
                  onChange={(e) => setPageSize(Number(e.target.value))}
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

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [birth, setBirth] = useState('');
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const canonical = phone.trim() || null;
      if (canonical) {
        const hit = await findCustomerByPhone(orgId, canonical);
        if (hit) {
          const err = new Error('DUP') as Error & {
            hit: { id: string; name: string };
          };
          err.hit = { id: hit.id, name: fullName(hit.first_name, hit.last_name) };
          throw err;
        }
      }
      const id = genId();
      await execute(
        `INSERT INTO customer
           (id, organization_id, first_name, last_name, phone, email, birth_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          orgId,
          firstName.trim(),
          lastName.trim() || null,
          canonical,
          email.trim() || null,
          birth || null,
        ],
      );
      return id;
    },
    onError: (e: Error & { hit?: { id: string; name: string } }) => {
      if (e.hit) setDup(e.hit);
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['clients', orgId] });
      qc.invalidateQueries({ queryKey: ['customers', orgId] });
      setFirstName('');
      setLastName('');
      setPhone('');
      setEmail('');
      setBirth('');
      setDup(null);
      onClose();
      navigate(`${ROUTES.client}/${id}`);
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Nuevo cliente">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Nombre"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <Input
            label="Apellido"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <PhoneInput
          label="WhatsApp"
          value={phone}
          onChange={(v) => {
            setPhone(v);
            setDup(null);
          }}
        />
        {dup && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm">
            <span className="text-danger">
              Ese número ya es de <b>{dup.name}</b>.
            </span>
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate(`${ROUTES.client}/${dup.id}`);
              }}
              className="shrink-0 rounded-lg bg-danger/20 px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/30"
            >
              Abrir ficha
            </button>
          </div>
        )}
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Cumpleaños"
          type="date"
          value={birth}
          onChange={(e) => setBirth(e.target.value)}
        />
        <Button
          className="w-full"
          disabled={!firstName.trim()}
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
  const qc = useQueryClient();

  const client = useQuery({
    queryKey: ['client', id],
    enabled: !!id,
    queryFn: () =>
      queryOne<Customer>('SELECT * FROM customer WHERE id = ?', [id]),
  });

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

  if (client.isLoading) return null;
  if (!client.data) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Header onBack={() => navigate(ROUTES.clients)} title="Cliente" />
        <Card>
          <EmptyState icon={Users} title="Cliente no encontrado" />
        </Card>
      </div>
    );
  }

  const c = client.data;
  const m = metrics.data;
  const visits = m?.visits ?? 0;
  const spent = m?.spent ?? 0;
  const avg = visits > 0 ? spent / visits : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Header
        onBack={() => navigate(ROUTES.clients)}
        title={fullName(c.first_name, c.last_name)}
        right={
          c.allergies ? (
            <Badge tone="danger">
              <TriangleAlert className="mr-1 inline h-3 w-3" /> Alergias
            </Badge>
          ) : undefined
        }
      />

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
            customer={c}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ['client', id] });
              qc.invalidateQueries({ queryKey: ['clients'] });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ClientForm({
  customer,
  onSaved,
}: {
  customer: Customer;
  onSaved: () => void;
}) {
  const staff = useStaff();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState(customer.first_name);
  const [lastName, setLastName] = useState(customer.last_name ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [birth, setBirth] = useState(customer.birth_date ?? '');
  const [preferred, setPreferred] = useState(customer.preferred_staff_id ?? '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const [allergies, setAllergies] = useState(customer.allergies ?? '');
  const [hairNotes, setHairNotes] = useState(customer.hair_notes ?? '');
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const canonical = phone.trim() || null;
      if (canonical) {
        const hit = await findCustomerByPhone(
          customer.organization_id,
          canonical,
        );
        if (hit && hit.id !== customer.id) {
          const err = new Error('DUP') as Error & {
            hit: { id: string; name: string };
          };
          err.hit = { id: hit.id, name: fullName(hit.first_name, hit.last_name) };
          throw err;
        }
      }
      return execute(
        `UPDATE customer SET
           first_name = ?, last_name = ?, phone = ?, email = ?, birth_date = ?,
           preferred_staff_id = ?, notes = ?, allergies = ?, hair_notes = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          firstName.trim(),
          lastName.trim() || null,
          canonical,
          email.trim() || null,
          birth || null,
          preferred || null,
          notes.trim() || null,
          allergies.trim() || null,
          hairNotes.trim() || null,
          new Date().toISOString(),
          customer.id,
        ],
      );
    },
    onError: (e: Error & { hit?: { id: string; name: string } }) => {
      if (e.hit) setDup(e.hit);
    },
    onSuccess: onSaved,
  });

  return (
    <Card className="sticky top-4">
      <CardHeader title="Ficha" subtitle="Datos y notas del cliente" />
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Nombre"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <Input
            label="Apellido"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <PhoneInput
          label="WhatsApp"
          value={phone}
          onChange={(v) => {
            setPhone(v);
            setDup(null);
          }}
        />
        {dup && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm">
            <span className="text-danger">
              Ese número ya es de <b>{dup.name}</b>.
            </span>
            <button
              type="button"
              onClick={() => navigate(`${ROUTES.client}/${dup.id}`)}
              className="shrink-0 rounded-lg bg-danger/20 px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/30"
            >
              Abrir ficha
            </button>
          </div>
        )}
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Cumpleaños"
          type="date"
          value={birth}
          onChange={(e) => setBirth(e.target.value)}
        />
        <Select
          label="Estilista preferido"
          value={preferred}
          onChange={(e) => setPreferred(e.target.value)}
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
          value={allergies}
          onChange={setAllergies}
          placeholder="Ej. alergia a la parafenilendiamina (tintes)"
          danger
        />
        <TextArea
          label="Notas capilares"
          value={hairNotes}
          onChange={setHairNotes}
          placeholder="Condición del cabello, historial químico, advertencias…"
        />
        <TextArea
          label="Notas generales"
          value={notes}
          onChange={setNotes}
          placeholder="Preferencias, observaciones…"
        />

        <Button
          className="w-full"
          disabled={!firstName.trim()}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Guardar ficha
        </Button>
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
      qc.invalidateQueries({ queryKey: ['color-records', customerId] });
    },
  });

  const del = useMutation({
    mutationFn: (recId: string) =>
      execute('DELETE FROM customer_color_record WHERE id = ?', [recId]),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['color-records', customerId] }),
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
            <Input
              label="Fecha"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
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

function Header({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
      </div>
      {right}
    </div>
  );
}
