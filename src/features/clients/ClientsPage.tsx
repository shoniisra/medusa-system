import { useMemo, useState, type ReactNode } from 'react';
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
} from 'lucide-react';
import { query, queryOne, execute } from '@/lib/db';
import { genId, money, dateShort, fullName, todayISO } from '@/lib/format';
import { useOrgId, useSession } from '@/store/session';
import { useStaff } from '@/features/pos/useCatalog';
import {
  Card,
  CardHeader,
  Button,
  Input,
  Select,
  Modal,
  Badge,
  EmptyState,
} from '@/components/ui';
import { ROUTES } from '@/config/constants';
import type { Customer, CustomerColorRecord } from '@/types';

/* ═══════════════════════════ Lista de clientes ═══════════════════════════ */

interface ClientRow extends Customer {
  visits: number;
  spent: number;
}

export function ClientsPage() {
  const orgId = useOrgId();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
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
                    AND s.status IN ('completed','partially_refunded')) AS spent
           FROM customer c
          WHERE c.organization_id = ? AND c.active = 1
          ORDER BY c.first_name`,
        [orgId],
      ),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = clients.data ?? [];
    if (!q) return list;
    return list.filter(
      (c) =>
        fullName(c.first_name, c.last_name).toLowerCase().includes(q) ||
        (c.phone ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q),
    );
  }, [clients.data, search]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Clientes</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4" /> Nuevo cliente
        </Button>
      </div>

      <Card>
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, WhatsApp o email…"
            className="input-base w-full pl-9"
          />
        </div>

        {filtered.length > 0 ? (
          <ul className="divide-y divide-white/5">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => navigate(`${ROUTES.client}/${c.id}`)}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-white/[0.02]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {fullName(c.first_name, c.last_name)}
                    </p>
                    <p className="truncate text-xs text-white/40">
                      {c.phone || 'Sin WhatsApp'}
                      {c.allergies ? ' · ⚠ alergias' : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-gold-200">
                      {money(c.spent)}
                    </p>
                    <p className="text-[10px] text-white/30">
                      {c.visits} visitas
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Users}
            title="Sin clientes"
            description="Creá tu primer cliente para empezar la ficha."
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

  const save = useMutation({
    mutationFn: async () => {
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
          phone.trim() || null,
          email.trim() || null,
          birth || null,
        ],
      );
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['clients', orgId] });
      qc.invalidateQueries({ queryKey: ['customers', orgId] });
      setFirstName('');
      setLastName('');
      setPhone('');
      setEmail('');
      setBirth('');
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
        <Input
          label="WhatsApp"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="09…"
        />
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
  const [firstName, setFirstName] = useState(customer.first_name);
  const [lastName, setLastName] = useState(customer.last_name ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [birth, setBirth] = useState(customer.birth_date ?? '');
  const [preferred, setPreferred] = useState(customer.preferred_staff_id ?? '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const [allergies, setAllergies] = useState(customer.allergies ?? '');
  const [hairNotes, setHairNotes] = useState(customer.hair_notes ?? '');

  const save = useMutation({
    mutationFn: () =>
      execute(
        `UPDATE customer SET
           first_name = ?, last_name = ?, phone = ?, email = ?, birth_date = ?,
           preferred_staff_id = ?, notes = ?, allergies = ?, hair_notes = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          firstName.trim(),
          lastName.trim() || null,
          phone.trim() || null,
          email.trim() || null,
          birth || null,
          preferred || null,
          notes.trim() || null,
          allergies.trim() || null,
          hairNotes.trim() || null,
          new Date().toISOString(),
          customer.id,
        ],
      ),
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
        <Input
          label="WhatsApp"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
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
