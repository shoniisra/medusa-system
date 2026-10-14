import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Shield, CheckCircle2 } from 'lucide-react';
import { query } from '@/lib/db';
import { useOrgId } from '@/store/session';
import { Button, Input, Badge, EmptyState } from '@/components/ui';
import { useToast } from '@/components/ui';
import type { AppUser } from '@/types';

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

interface UserRow extends AppUser {
  has_password: 0 | 1;
}

function useUsers() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['users-access', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<UserRow>(
        `SELECT id, organization_id, username, full_name, email, phone, role,
                active, last_login_at, created_at, updated_at,
                CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END AS has_password
           FROM app_user
          WHERE organization_id = ? AND active = 1
          ORDER BY full_name`,
        [orgId],
      ),
  });
}

function useSetPassword() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: async ({
      userId,
      password,
    }: {
      userId: string;
      password: string;
    }) => {
      const res = await fetch('/api/set-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: userId, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Error al guardar la contraseña.');
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users-access', orgId] });
      void qc.invalidateQueries({ queryKey: ['login-users', orgId] });
    },
  });
}

function UserPasswordForm({
  user,
  onDone,
}: {
  user: UserRow;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { mutateAsync, isPending } = useSetPassword();
  const { show } = useToast();

  async function handleSave() {
    if (password.length < 4) {
      show({ title: 'Mínimo 4 caracteres', tone: 'danger' });
      return;
    }
    if (password !== confirm) {
      show({ title: 'Las contraseñas no coinciden', tone: 'danger' });
      return;
    }
    try {
      await mutateAsync({ userId: user.id, password });
      show({ title: 'Contraseña guardada', tone: 'success' });
      onDone();
    } catch (e) {
      show({
        title: e instanceof Error ? e.message : 'Error al guardar',
        tone: 'danger',
      });
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-gold/20 bg-gold/5 p-4">
      <p className="text-sm font-medium text-gold-200">
        Contraseña para {user.full_name}
      </p>
      <Input
        label="Nueva contraseña (mín. 4 caracteres)"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        autoFocus
      />
      <Input
        label="Confirmar contraseña"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
        autoComplete="new-password"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void handleSave()} disabled={isPending}>
          {isPending ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function UserAccessPanel() {
  const { data: users = [], isLoading } = useUsers();
  const [editingId, setEditingId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (!users.length) {
    return (
      <EmptyState
        title="Sin usuarios"
        description="No hay usuarios activos en esta organización."
        icon={Shield}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-white/50">
        Asigná contraseñas a las colaboradoras para que puedan ingresar al
        sistema desde sus dispositivos. Los usuarios sin contraseña solo pueden
        ingresar seleccionándose en el menú desplegable.
      </p>

      {users.map((user) => (
        <div key={user.id} className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium text-white">{user.full_name}</p>
                <Badge tone={ROLE_TONES[user.role] ?? 'muted'}>
                  {ROLE_LABELS[user.role] ?? user.role}
                </Badge>
              </div>
              <p className="text-xs text-white/40">@{user.username}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {user.has_password === 1 && (
                <CheckCircle2 className="h-4 w-4 text-success" aria-label="Con contraseña" />
              )}
              <Button
                size="sm"
                variant={user.has_password ? 'ghost' : 'outline'}
                onClick={() =>
                  setEditingId(editingId === user.id ? null : user.id)
                }
              >
                <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                {user.has_password ? 'Cambiar' : 'Asignar'}
              </Button>
            </div>
          </div>

          {editingId === user.id && (
            <UserPasswordForm user={user} onDone={() => setEditingId(null)} />
          )}
        </div>
      ))}
    </div>
  );
}
