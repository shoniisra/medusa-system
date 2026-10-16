import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  KeyRound,
  CheckCircle2,
  UserPlus,
  X,
  UserRound,
  Star,
  MessageCircle,
} from 'lucide-react';
import { query, execute, batch } from '@/lib/db';
import { useOrgId } from '@/store/session';
import { SERVICE_CATEGORIES } from '@/config/constants';
import {
  Button,
  Input,
  Badge,
  Select,
  EmptyState,
  Modal,
  useToast,
} from '@/components/ui';
import {
  GOOGLE_EVENT_COLORS,
  DEFAULT_CALENDAR_COLOR,
  findCalendarColor,
} from '@/config/colors';
import { genId } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Service } from '@/types';

/* ─── Constantes ─────────────────────────────────────────────────────────── */

const PAY_CYCLE_OPTIONS = [
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quincenal' },
  { value: 'monthly', label: 'Mensual' },
];

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Admin',
  manager: 'Gerente',
  cashier: 'Cajero/a',
  reception: 'Recepción',
  staff: 'Colaboradora',
  viewer: 'Solo vista',
};

const ROLE_TONES: Record<string, 'gold' | 'success' | 'info' | 'muted'> = {
  owner: 'gold',
  admin: 'gold',
  manager: 'success',
  cashier: 'info',
  reception: 'info',
  staff: 'muted',
  viewer: 'muted',
};

/* ─── Tipos ──────────────────────────────────────────────────────────────── */

interface StaffWithUser {
  id: string;
  first_name: string;
  last_name: string | null;
  color: string | null;
  phone: string | null;
  email: string | null;
  employee_code: string | null;
  default_pay_cycle: string | null;
  notes: string | null;
  user_id: string | null;
  username: string | null;
  role: string | null;
  has_password: 0 | 1 | null;
}

interface StaffProfileDraft {
  first_name: string;
  last_name: string;
  color: string;
  phone: string;
  email: string;
  employee_code: string;
  default_pay_cycle: string;
  notes: string;
}

interface StaffCategoryRow {
  id: string;
  staff_member_id: string;
  category: string;
  priority: number;
  active: 0 | 1;
}

interface StaffExclusionRow {
  id: string;
  staff_member_id: string;
  service_id: string;
  service_name: string;
  service_category: string;
}

/* ─── Queries ─────────────────────────────────────────────────────────────── */

function useStaffWithUsers() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['staff-with-users', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffWithUser>(
        // Colaboradoras con perfil de staff.
        `SELECT sm.id, sm.first_name, sm.last_name, sm.color,
                sm.phone, sm.email, sm.employee_code, sm.default_pay_cycle, sm.notes,
                au.id AS user_id, au.username, au.role,
                CASE WHEN au.password_hash IS NOT NULL AND au.password_hash != '' THEN 1 ELSE 0 END AS has_password
           FROM staff_member sm
           LEFT JOIN app_user au ON au.id = sm.app_user_id
          WHERE sm.organization_id = ? AND sm.active = 1
        UNION ALL
        -- Usuarios (admin/manager) sin perfil de colaboradora.
        -- Nombre a mostrar = username capitalizado (ej: "michelle" → "Michelle").
        SELECT au.id,
               UPPER(SUBSTR(au.username, 1, 1)) || SUBSTR(au.username, 2) AS first_name,
               NULL AS last_name, NULL AS color,
               au.phone, au.email, NULL AS employee_code, NULL AS default_pay_cycle, NULL AS notes,
               au.id AS user_id, au.username, au.role,
               CASE WHEN au.password_hash IS NOT NULL AND au.password_hash != '' THEN 1 ELSE 0 END AS has_password
          FROM app_user au
         WHERE au.organization_id = ? AND au.active = 1
           AND NOT EXISTS (
               SELECT 1 FROM staff_member sm2
                WHERE sm2.app_user_id = au.id AND sm2.active = 1
           )
        ORDER BY first_name`,
        [orgId, orgId],
      ),
  });
}

function useStaffCategories() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['staff-categories-all', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffCategoryRow>(
        `SELECT sc.id, sc.staff_member_id, sc.category, sc.priority, sc.active
           FROM staff_category sc
           JOIN staff_member sm ON sm.id = sc.staff_member_id
          WHERE sm.organization_id = ?`,
        [orgId],
      ),
  });
}

function useStaffExclusions() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['staff-exclusions-all', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffExclusionRow>(
        `SELECT sse.id, sse.staff_member_id, sse.service_id,
                sv.name AS service_name, sv.category AS service_category
           FROM staff_service_exclusion sse
           JOIN staff_member sm ON sm.id = sse.staff_member_id
           JOIN service sv ON sv.id = sse.service_id
          WHERE sm.organization_id = ? AND sse.active = 1`,
        [orgId],
      ),
  });
}

function useOrgServices() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['services-for-exclusions', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<Pick<Service, 'id' | 'name' | 'category'>>(
        `SELECT id, name, category FROM service WHERE organization_id = ? AND active = 1 ORDER BY category, name`,
        [orgId],
      ),
  });
}

/* ─── Mutations ───────────────────────────────────────────────────────────── */

function useCreateStaff() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: StaffProfileDraft) => {
      const now = new Date().toISOString();
      await execute(
        `INSERT INTO staff_member
           (id, organization_id, first_name, last_name, color, phone, email,
            employee_code, default_pay_cycle, notes, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          genId(),
          orgId,
          draft.first_name.trim(),
          draft.last_name.trim() || null,
          draft.color || DEFAULT_CALENDAR_COLOR.hex,
          draft.phone.trim() || null,
          draft.email.trim() || null,
          draft.employee_code.trim() || null,
          draft.default_pay_cycle || 'monthly',
          draft.notes.trim() || null,
          now,
          now,
        ],
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-with-users', orgId] });
    },
  });
}

function useUpdateStaff() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: StaffProfileDraft }) => {
      const now = new Date().toISOString();
      await execute(
        `UPDATE staff_member
            SET first_name = ?, last_name = ?, color = ?, phone = ?, email = ?,
                employee_code = ?, default_pay_cycle = ?, notes = ?, updated_at = ?
          WHERE id = ?`,
        [
          draft.first_name.trim(),
          draft.last_name.trim() || null,
          draft.color || DEFAULT_CALENDAR_COLOR.hex,
          draft.phone.trim() || null,
          draft.email.trim() || null,
          draft.employee_code.trim() || null,
          draft.default_pay_cycle || 'monthly',
          draft.notes.trim() || null,
          now,
          id,
        ],
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-with-users', orgId] });
    },
  });
}

function useToggleCategory() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      staffMemberId,
      category,
      existing,
    }: {
      staffMemberId: string;
      category: string;
      existing: StaffCategoryRow | undefined;
    }) => {
      const now = new Date().toISOString();
      if (!existing) {
        await execute(
          `INSERT INTO staff_category (id, staff_member_id, category, priority, active, created_at, updated_at)
           VALUES (?, ?, ?, 1, 1, ?, ?)`,
          [genId(), staffMemberId, category, now, now],
        );
      } else {
        await execute(
          `UPDATE staff_category SET active = ?, updated_at = ? WHERE id = ?`,
          [existing.active === 1 ? 0 : 1, now, existing.id],
        );
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-categories-all', orgId] });
    },
  });
}

function useCreateUser() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      staffMemberId,
      firstName,
      lastName,
    }: {
      staffMemberId: string;
      firstName: string;
      lastName: string | null;
    }) => {
      const userId = genId();
      const base = [firstName, lastName]
        .filter(Boolean)
        .join('.')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9.]/g, '');
      const username = `${base}.${userId.slice(0, 4)}`;
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      const now = new Date().toISOString();

      await batch([
        {
          sql: `INSERT INTO app_user (id, organization_id, username, full_name, role, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'staff', 1, ?, ?)`,
          args: [userId, orgId, username, fullName, now, now],
        },
        {
          sql: `UPDATE staff_member SET app_user_id = ?, updated_at = ? WHERE id = ?`,
          args: [userId, now, staffMemberId],
        },
      ]);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-with-users', orgId] });
      void qc.invalidateQueries({ queryKey: ['login-users', orgId] });
    },
  });
}

function useSetPassword() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const res = await fetch('/api/set-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: userId, org_id: orgId, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Error al guardar contraseña');
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-with-users', orgId] });
    },
  });
}

function useRemoveExclusion() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (exclusionId: string) => {
      const now = new Date().toISOString();
      await execute(
        `UPDATE staff_service_exclusion SET active = 0, updated_at = ? WHERE id = ?`,
        [now, exclusionId],
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-exclusions-all', orgId] });
    },
  });
}

function useAddExclusion() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      staffMemberId,
      serviceId,
    }: {
      staffMemberId: string;
      serviceId: string;
    }) => {
      const now = new Date().toISOString();
      const existing = await query<{ id: string }>(
        `SELECT id FROM staff_service_exclusion WHERE staff_member_id = ? AND service_id = ? LIMIT 1`,
        [staffMemberId, serviceId],
      );
      if (existing.length > 0) {
        await execute(
          `UPDATE staff_service_exclusion SET active = 1, updated_at = ? WHERE id = ?`,
          [now, existing[0].id],
        );
      } else {
        await execute(
          `INSERT INTO staff_service_exclusion (id, staff_member_id, service_id, active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
          [genId(), staffMemberId, serviceId, now, now],
        );
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-exclusions-all', orgId] });
    },
  });
}

/* ─── ColorPicker ─────────────────────────────────────────────────────────── */

function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const current = findCalendarColor(value);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-white/60">Color identificador</span>
        <span className="text-xs text-white/40">
          {current ? current.name : value ? value.toUpperCase() : '—'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-2 sm:grid-cols-6">
        {GOOGLE_EVENT_COLORS.map((c) => {
          const on = c.hex.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c.hex}
              type="button"
              aria-pressed={on}
              title={c.name}
              onClick={() => onChange(c.hex)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition active:scale-[0.97]',
                on
                  ? 'border-white/50 bg-white/10 font-medium text-white'
                  : 'border-transparent text-white/60 hover:border-white/20 hover:bg-white/5',
              )}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.hex }} />
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── StaffProfileForm ────────────────────────────────────────────────────── */

function emptyDraft(staff?: StaffWithUser): StaffProfileDraft {
  return {
    first_name: staff?.first_name ?? '',
    last_name: staff?.last_name ?? '',
    color: staff?.color ?? DEFAULT_CALENDAR_COLOR.hex,
    phone: staff?.phone ?? '',
    email: staff?.email ?? '',
    employee_code: staff?.employee_code ?? '',
    default_pay_cycle: staff?.default_pay_cycle ?? 'monthly',
    notes: staff?.notes ?? '',
  };
}

function StaffProfileForm({
  staff,
  onDone,
}: {
  staff?: StaffWithUser;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<StaffProfileDraft>(() => emptyDraft(staff));
  const { mutateAsync: create, isPending: creating } = useCreateStaff();
  const { mutateAsync: update, isPending: updating } = useUpdateStaff();
  const { show } = useToast();
  const isPending = creating || updating;

  function set<K extends keyof StaffProfileDraft>(k: K, v: StaffProfileDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  async function save() {
    if (!draft.first_name.trim()) {
      show({ title: 'El nombre es obligatorio', tone: 'danger' });
      return;
    }
    try {
      if (staff) {
        await update({ id: staff.id, draft });
        show({ title: 'Perfil actualizado', tone: 'success' });
      } else {
        await create(draft);
        show({ title: 'Colaboradora creada', tone: 'success' });
      }
      onDone();
    } catch {
      show({ title: 'Error al guardar', tone: 'danger' });
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Nombre *"
          value={draft.first_name}
          onChange={(e) => set('first_name', e.target.value)}
          autoFocus={!staff}
        />
        <Input
          label="Apellido"
          value={draft.last_name}
          onChange={(e) => set('last_name', e.target.value)}
        />
      </div>

      <ColorPicker value={draft.color} onChange={(hex) => set('color', hex)} />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Teléfono"
          value={draft.phone}
          onChange={(e) => set('phone', e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          value={draft.email}
          onChange={(e) => set('email', e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Código empleado"
          value={draft.employee_code}
          onChange={(e) => set('employee_code', e.target.value)}
        />
        <Select
          label="Ciclo de pago"
          value={draft.default_pay_cycle}
          onChange={(e) => set('default_pay_cycle', e.target.value)}
        >
          {PAY_CYCLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      <Input
        label="Notas"
        value={draft.notes}
        onChange={(e) => set('notes', e.target.value)}
      />

      <div className="flex gap-2 pt-1">
        <Button onClick={() => void save()} disabled={isPending}>
          {isPending ? 'Guardando…' : staff ? 'Guardar cambios' : 'Crear colaboradora'}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/* ─── PasswordForm ────────────────────────────────────────────────────────── */

function PasswordForm({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const { mutateAsync, isPending } = useSetPassword();
  const { show } = useToast();

  async function save() {
    if (pw.length < 4) {
      show({ title: 'Mínimo 4 caracteres', tone: 'danger' });
      return;
    }
    if (pw !== confirm) {
      show({ title: 'Las contraseñas no coinciden', tone: 'danger' });
      return;
    }
    try {
      await mutateAsync({ userId, password: pw });
      show({ title: 'Contraseña guardada', tone: 'success' });
      onDone();
    } catch (e) {
      show({ title: e instanceof Error ? e.message : 'Error', tone: 'danger' });
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-gold/20 bg-gold/5 p-3">
      <Input
        label="Nueva contraseña (mín. 4 caracteres)"
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoComplete="new-password"
      />
      <Input
        label="Confirmar"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
        autoComplete="new-password"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={isPending}>
          {isPending ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/* ─── CategoryToggles ─────────────────────────────────────────────────────── */

function CategoryToggles({
  staffMemberId,
  categories,
}: {
  staffMemberId: string;
  categories: StaffCategoryRow[];
}) {
  const { mutate, isPending } = useToggleCategory();

  return (
    <div className="grid grid-cols-2 gap-2">
      {SERVICE_CATEGORIES.map((cat) => {
        const row = categories.find((c) => c.category === cat);
        const on = row?.active === 1;
        return (
          <button
            key={cat}
            type="button"
            disabled={isPending}
            onClick={() => mutate({ staffMemberId, category: cat, existing: row })}
            className={cn(
              'flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl border p-2.5 text-center text-sm font-medium transition active:scale-[0.97]',
              on
                ? 'border-gold/60 bg-gold/15 text-gold-100 shadow-gold-glow'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]',
            )}
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}

/* ─── ExclusionsList ──────────────────────────────────────────────────────── */

function ExclusionsList({
  staffMemberId,
  exclusions,
  services,
}: {
  staffMemberId: string;
  exclusions: StaffExclusionRow[];
  services: Pick<Service, 'id' | 'name' | 'category'>[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const { mutate: remove, isPending: removing } = useRemoveExclusion();
  const { mutate: add, isPending: adding } = useAddExclusion();

  const excludedIds = new Set(exclusions.map((e) => e.service_id));
  const available = services.filter((s) => !excludedIds.has(s.id));

  function handleAdd() {
    if (!selectedServiceId) return;
    add(
      { staffMemberId, serviceId: selectedServiceId },
      {
        onSuccess: () => {
          setSelectedServiceId('');
          setAddOpen(false);
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      {exclusions.length === 0 && !addOpen && (
        <p className="text-xs text-white/40">
          Sin exclusiones — atiende todos los servicios de sus categorías.
        </p>
      )}

      {exclusions.map((exc) => (
        <div
          key={exc.id}
          className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
        >
          <div className="min-w-0">
            <p className="text-sm text-white">{exc.service_name}</p>
            <p className="text-xs text-white/40">{exc.service_category}</p>
          </div>
          <button
            type="button"
            disabled={removing}
            onClick={() => remove(exc.id)}
            className="shrink-0 rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-danger"
            title="Quitar exclusión"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      {!addOpen && (
        <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Excluir servicio
        </Button>
      )}

      {addOpen && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Select
              label="Servicio a excluir"
              value={selectedServiceId}
              onChange={(e) => setSelectedServiceId(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.category ? ` (${s.category})` : ''}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" onClick={handleAdd} disabled={!selectedServiceId || adding}>
            {adding ? '…' : 'Agregar'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAddOpen(false);
              setSelectedServiceId('');
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── EditModal ───────────────────────────────────────────────────────────── */

function EditModal({
  staff,
  onClose,
}: {
  staff: StaffWithUser | null; // null = nuevo
  onClose: () => void;
}) {
  const [pwOpen, setPwOpen] = useState(false);
  const { mutate: createUser, isPending: creatingUser } = useCreateUser();
  const { show } = useToast();

  const displayName = staff
    ? [staff.first_name, staff.last_name].filter(Boolean).join(' ')
    : null;

  function handleCreateUser() {
    if (!staff) return;
    createUser(
      { staffMemberId: staff.id, firstName: staff.first_name, lastName: staff.last_name },
      {
        onSuccess: () => show({ title: 'Usuario creado', tone: 'success' }),
        onError: () => show({ title: 'Error al crear usuario', tone: 'danger' }),
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={staff ? `Editar · ${displayName}` : 'Nueva colaboradora'}
    >
      <div className="space-y-5">
        <StaffProfileForm staff={staff ?? undefined} onDone={onClose} />

        {/* Sección de cuenta — solo para colaboradoras existentes */}
        {staff && (
          <div className="border-t border-white/10 pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
              Cuenta
            </p>
            {!staff.user_id ? (
              <div className="flex items-center gap-3">
                <p className="text-sm text-white/50">Sin usuario vinculado.</p>
                <Button size="sm" onClick={handleCreateUser} disabled={creatingUser}>
                  <UserPlus className="h-3.5 w-3.5" />
                  {creatingUser ? 'Creando…' : 'Crear acceso'}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">@{staff.username}</p>
                    {staff.has_password === 1 ? (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="h-3 w-3" /> Con contraseña
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-white/40">
                        Sin contraseña (accede por menú)
                      </p>
                    )}
                  </div>
                  {!pwOpen && (
                    <Button
                      size="sm"
                      variant={staff.has_password ? 'ghost' : 'outline'}
                      onClick={() => setPwOpen(true)}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      {staff.has_password ? 'Cambiar' : 'Asignar contraseña'}
                    </Button>
                  )}
                </div>
                {pwOpen && (
                  <PasswordForm userId={staff.user_id} onDone={() => setPwOpen(false)} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─── SpecialtiesPanel ────────────────────────────────────────────────────── */

function SpecialtiesPanel({
  staff,
  categories,
  exclusions,
  services,
  onClose,
}: {
  staff: StaffWithUser;
  categories: StaffCategoryRow[];
  exclusions: StaffExclusionRow[];
  services: Pick<Service, 'id' | 'name' | 'category'>[];
  onClose: () => void;
}) {
  const displayName = [staff.first_name, staff.last_name].filter(Boolean).join(' ');

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel: bottom-sheet en mobile, right panel en desktop */}
      <div
        className={cn(
          'fixed z-50 overflow-y-auto border-white/10 bg-ink-900',
          // Mobile: bottom sheet
          'bottom-0 left-0 right-0 max-h-[85dvh] rounded-t-2xl border-t px-4 pb-8 pt-4',
          // Desktop: right panel
          'sm:inset-y-0 sm:bottom-auto sm:left-auto sm:right-0 sm:top-0 sm:max-h-full sm:w-[400px] sm:rounded-none sm:rounded-l-2xl sm:border-l sm:border-t-0 sm:px-5 sm:py-5',
        )}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/20"
              style={{ background: staff.color ?? '#64748b' }}
            />
            <h2 className="font-semibold text-white">{displayName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Especialidades */}
        <section className="mb-5">
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-white/40">
            Especialidades
          </p>
          <CategoryToggles staffMemberId={staff.id} categories={categories} />
        </section>

        {/* Servicios excluidos */}
        <section>
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-white/40">
            Servicios excluidos
          </p>
          <ExclusionsList
            staffMemberId={staff.id}
            exclusions={exclusions}
            services={services}
          />
        </section>
      </div>
    </>
  );
}

/* ─── StaffTeamPage ───────────────────────────────────────────────────────── */

export function StaffTeamPage() {
  const [editStaff, setEditStaff] = useState<StaffWithUser | null | 'new'>(null);
  const [specialtiesStaff, setSpecialtiesStaff] = useState<StaffWithUser | null>(null);

  const { data: staffList = [], isLoading } = useStaffWithUsers();
  const { data: allCategories = [] } = useStaffCategories();
  const { data: allExclusions = [] } = useStaffExclusions();
  const { data: services = [] } = useOrgServices();

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Miembros del equipo</h1>
          <p className="text-sm text-white/40">Colaboradoras, especialidades y accesos.</p>
        </div>
        <Button onClick={() => setEditStaff('new')}>
          <Plus className="h-4 w-4" /> Nueva colaboradora
        </Button>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : staffList.length === 0 ? (
        <EmptyState
          title="Sin colaboradoras"
          description='Creá la primera con el botón "Nueva colaboradora".'
          icon={UserRound}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-white/40">
                <th className="px-4 py-2.5 text-left font-medium">Nombre</th>
                <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">
                  Teléfono
                </th>
                <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">
                  Cuenta
                </th>
                <th className="px-4 py-2.5 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {staffList.map((staff) => {
                const displayName = [staff.first_name, staff.last_name]
                  .filter(Boolean)
                  .join(' ');
                const staffCategories = allCategories.filter(
                  (c) => c.staff_member_id === staff.id && c.active === 1,
                );

                return (
                  <tr
                    key={staff.id}
                    className="transition-colors hover:bg-white/[0.02]"
                  >
                    {/* Nombre + rol */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20"
                          style={{ background: staff.color ?? '#64748b' }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white">{displayName}</span>
                            {staff.role && (
                              <Badge tone={ROLE_TONES[staff.role] ?? 'muted'}>
                                {ROLE_LABELS[staff.role] ?? staff.role}
                              </Badge>
                            )}
                          </div>
                          {/* Cuenta en mobile */}
                          <div className="mt-0.5 sm:hidden">
                            {staff.user_id ? (
                              <span className="text-xs text-white/50">
                                @{staff.username}
                                {staff.has_password === 1 && (
                                  <CheckCircle2 className="ml-1 inline h-3 w-3 text-success" />
                                )}
                              </span>
                            ) : (
                              <span className="text-xs text-white/30">Sin cuenta</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Teléfono (md+) */}
                    <td className="hidden px-4 py-3 md:table-cell">
                      {staff.phone ? (
                        <a
                          href={`https://wa.me/${staff.phone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-white/60 transition-colors hover:text-success"
                          title={`WhatsApp ${staff.phone}`}
                        >
                          <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                          {staff.phone}
                        </a>
                      ) : (
                        <span className="text-xs text-white/25">—</span>
                      )}
                    </td>

                    {/* Cuenta (desktop) */}
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {staff.user_id ? (
                        <div className="flex items-center gap-1.5 text-white/60">
                          <span className="font-mono text-xs">@{staff.username}</span>
                          {staff.has_password === 1 ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          ) : (
                            <KeyRound className="h-3.5 w-3.5 text-white/30" />
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-white/30">Sin cuenta</span>
                      )}
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSpecialtiesStaff(staff)}
                          title={
                            staffCategories.length > 0
                              ? `${staffCategories.length} categoría(s)`
                              : 'Sin especialidades'
                          }
                        >
                          <Star className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Especialidades</span>
                          {staffCategories.length > 0 && (
                            <span className="ml-0.5 text-xs text-white/50">
                              ({staffCategories.length})
                            </span>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditStaff(staff)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Editar</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal editar / crear */}
      {editStaff !== null && (
        <EditModal
          staff={editStaff === 'new' ? null : editStaff}
          onClose={() => setEditStaff(null)}
        />
      )}

      {/* Panel de especialidades */}
      {specialtiesStaff && (
        <SpecialtiesPanel
          staff={specialtiesStaff}
          categories={allCategories.filter((c) => c.staff_member_id === specialtiesStaff.id)}
          exclusions={allExclusions.filter((e) => e.staff_member_id === specialtiesStaff.id)}
          services={services}
          onClose={() => setSpecialtiesStaff(null)}
        />
      )}
    </div>
  );
}
