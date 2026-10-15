import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  KeyRound,
  CheckCircle2,
  UserPlus,
  X,
  Plus,
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
  useToast,
} from '@/components/ui';
import { genId } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Service } from '@/types';

/* ─── Tipos locales ──────────────────────────────────────────────────────── */

interface StaffWithUser {
  id: string;
  first_name: string;
  last_name: string | null;
  color: string | null;
  user_id: string | null;
  username: string | null;
  role: string | null;
  has_password: 0 | 1 | null;
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

/* ─── Queries ─────────────────────────────────────────────────────────────── */

function useStaffWithUsers() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['staff-with-users', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<StaffWithUser>(
        `SELECT sm.id, sm.first_name, sm.last_name, sm.color,
                au.id AS user_id, au.username, au.role,
                CASE WHEN au.password_hash IS NOT NULL AND au.password_hash != '' THEN 1 ELSE 0 END AS has_password
           FROM staff_member sm
           LEFT JOIN app_user au ON au.id = sm.app_user_id
          WHERE sm.organization_id = ? AND sm.active = 1
          ORDER BY sm.first_name`,
        [orgId],
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

/* ─── Sub-componentes ─────────────────────────────────────────────────────── */

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

function CategoryToggles({
  staffMemberId,
  categories,
}: {
  staffMemberId: string;
  categories: StaffCategoryRow[];
}) {
  const { mutate, isPending } = useToggleCategory();

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
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
              'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl border p-2.5 text-center text-sm font-medium transition active:scale-[0.97]',
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
            className="shrink-0 rounded p-1 text-white/40 hover:bg-white/10 hover:text-danger transition-colors"
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
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!selectedServiceId || adding}
          >
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

/* ─── StaffCard (fila expandible por colaborador) ─────────────────────────── */

function StaffCard({
  staff,
  categories,
  exclusions,
  services,
}: {
  staff: StaffWithUser;
  categories: StaffCategoryRow[];
  exclusions: StaffExclusionRow[];
  services: Pick<Service, 'id' | 'name' | 'category'>[];
}) {
  const orgId = useOrgId();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const { mutate: createUser, isPending: creating } = useCreateUser();
  const { show } = useToast();

  const displayName = [staff.first_name, staff.last_name].filter(Boolean).join(' ');

  function handleCreateUser() {
    createUser(
      { staffMemberId: staff.id, firstName: staff.first_name, lastName: staff.last_name },
      {
        onSuccess: () => show({ title: 'Usuario creado', tone: 'success' }),
        onError: () => show({ title: 'Error al crear usuario', tone: 'danger' }),
      },
    );
  }

  // Silencia unused variable — orgId solo se usa para contextualizar el PasswordForm
  void orgId;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      {/* Cabecera colapsable */}
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/20"
          style={{ background: staff.color ?? '#64748b' }}
        />
        <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="truncate font-medium text-white">{displayName}</span>
          {staff.role && (
            <Badge tone={ROLE_TONES[staff.role] ?? 'muted'}>
              {ROLE_LABELS[staff.role] ?? staff.role}
            </Badge>
          )}
          {!staff.user_id && (
            <Badge tone="muted">Sin cuenta</Badge>
          )}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-white/40" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-white/40" />
        )}
      </button>

      {/* Panel expandido */}
      {open && (
        <div className="space-y-5 border-t border-white/10 px-4 pb-5 pt-4">
          {/* ── Cuenta ── */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
              Cuenta
            </p>
            {!staff.user_id ? (
              <div className="flex items-center gap-3">
                <p className="text-sm text-white/50">Sin usuario vinculado.</p>
                <Button size="sm" onClick={handleCreateUser} disabled={creating}>
                  <UserPlus className="h-3.5 w-3.5" />
                  {creating ? 'Creando…' : 'Crear acceso'}
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
          </section>

          {/* ── Especialidades ── */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
              Especialidades
            </p>
            <CategoryToggles staffMemberId={staff.id} categories={categories} />
          </section>

          {/* ── Servicios excluidos ── */}
          <section>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
              Servicios excluidos
            </p>
            <ExclusionsList
              staffMemberId={staff.id}
              exclusions={exclusions}
              services={services}
            />
          </section>
        </div>
      )}
    </div>
  );
}

/* ─── Exportación principal ───────────────────────────────────────────────── */

export function StaffTeamManager() {
  const { data: staffList = [], isLoading } = useStaffWithUsers();
  const { data: allCategories = [] } = useStaffCategories();
  const { data: allExclusions = [] } = useStaffExclusions();
  const { data: services = [] } = useOrgServices();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (!staffList.length) {
    return (
      <EmptyState
        title="Sin colaboradoras"
        description="Agregá colaboradoras en Configuración para empezar."
        icon={UserPlus}
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-white/40">
        Hacé clic en una colaboradora para gestionar su acceso, especialidades y
        servicios excluidos.
      </p>
      {staffList.map((staff) => (
        <StaffCard
          key={staff.id}
          staff={staff}
          categories={allCategories.filter((c) => c.staff_member_id === staff.id)}
          exclusions={allExclusions.filter((e) => e.staff_member_id === staff.id)}
          services={services}
        />
      ))}
    </div>
  );
}
