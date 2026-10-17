import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Eye, EyeOff } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { query, queryOne } from '@/lib/db';
import { authenticateUser } from './authenticateUser';
import { useSession } from '@/store/session';
import { APP_NAME, ROUTES } from '@/config/constants';
import { Button, Card, Select, Input } from '@/components/ui';
import type { AppUser, Branch, Organization } from '@/types';

interface UserForLogin extends AppUser {
  default_branch_id: string | null;
}

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);

  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Detecta la única organización activa (o usa la variable de entorno como hint).
  const orgQuery = useQuery({
    queryKey: ['login-org'],
    queryFn: async () => {
      const hint = import.meta.env.VITE_DEFAULT_ORG_ID as string | undefined;
      if (hint) {
        const org = await queryOne<Organization>(
          `SELECT * FROM organization WHERE id = ? AND active = 1`,
          [hint],
        );
        if (org) return org;
      }
      // Fallback: primera organización activa.
      return queryOne<Organization>(
        `SELECT * FROM organization WHERE active = 1 ORDER BY name LIMIT 1`,
      );
    },
  });

  const org = orgQuery.data ?? null;
  const orgId = org?.id ?? '';

  const users = useQuery({
    queryKey: ['login-users', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<UserForLogin>(
        `SELECT id, organization_id, username, full_name, email, phone, role,
                active, last_login_at, created_at, updated_at, default_branch_id
           FROM app_user
          WHERE organization_id = ? AND active = 1
          ORDER BY full_name`,
        [orgId],
      ),
  });

  const selectedUser = users.data?.find((u) => u.id === userId);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPassword('');
    setError('');
  }, [userId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleEnter() {
    if (loading) return;
    if (!orgId || !userId) {
      setError('Seleccioná un usuario.');
      return;
    }
    if (password.length !== 4) {
      setError('Ingresá tu token de 4 dígitos.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      // Resuelve la sucursal: default del usuario, o primera de la org.
      const branchId =
        selectedUser?.default_branch_id ??
        (await queryOne<Branch>(
          `SELECT id FROM branch WHERE organization_id = ? AND active = 1 ORDER BY name LIMIT 1`,
          [orgId],
        ).then((b) => b?.id ?? ''));

      if (!branchId) {
        setError('No hay sucursales activas para esta organización.');
        setLoading(false);
        return;
      }

      const authenticatedUser = await authenticateUser(userId, orgId, branchId, password);

      // Hidratar sesión local.
      const branch = await queryOne<Branch>(
        `SELECT * FROM branch WHERE id = ? AND organization_id = ? AND active = 1`,
        [branchId, orgId],
      );
      if (!org || !branch) {
        setError('Error al cargar los datos de sesión.');
        return;
      }
      setSession({ organization: org, user: authenticatedUser, branch });
      navigate(ROUTES.dashboard, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar.');
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = !!userId && password.length === 4;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card gold className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Scissors className="h-8 w-8 text-gold-300" />
          <h1 className="brand-script text-5xl">{APP_NAME}</h1>
          {org && (
            <p className="text-sm font-medium text-white/70">{org.name}</p>
          )}
        </div>

        <div className="space-y-4">
          <Select
            label="Usuario"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={loading || !orgId || users.isLoading}
          >
            <option value="">Seleccionar…</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </Select>

          <div className="relative">
            <Input
              label="Token (4 dígitos)"
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                setPassword(v);
              }}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && void handleEnter()}
              inputMode="numeric"
              maxLength={4}
              autoComplete="one-time-code"
              disabled={loading || !userId}
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-9 text-white/40 hover:text-white"
              tabIndex={-1}
            >
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button
            className="w-full"
            size="lg"
            onClick={() => void handleEnter()}
            disabled={!canSubmit || loading}
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
