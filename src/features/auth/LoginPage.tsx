import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Eye, EyeOff } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { query } from '@/lib/db';
import { useSession } from '@/store/session';
import { APP_NAME, ROUTES } from '@/config/constants';
import { Button, Card, Select, Input } from '@/components/ui';
import type { AppUser, Branch, Organization } from '@/types';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);

  const [orgId, setOrgId] = useState('');
  const [userId, setUserId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const orgs = useQuery({
    queryKey: ['orgs'],
    queryFn: () =>
      query<Organization>(
        'SELECT * FROM organization WHERE active = 1 ORDER BY name',
      ),
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const def = import.meta.env.VITE_DEFAULT_ORG_ID;
    if (!orgId && def) setOrgId(def);
    else if (!orgId && orgs.data?.length) setOrgId(orgs.data[0].id);
  }, [orgs.data, orgId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Usuarios: incluir has_password como columna derivada para no exponer el hash.
  const users = useQuery({
    queryKey: ['login-users', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<AppUser & { has_password: 0 | 1 }>(
        `SELECT id, organization_id, username, full_name, email, phone, role,
                active, last_login_at, created_at, updated_at,
                CASE WHEN password_hash IS NOT NULL AND password_hash != '' THEN 1 ELSE 0 END AS has_password
           FROM app_user
          WHERE organization_id = ? AND active = 1
          ORDER BY full_name`,
        [orgId],
      ),
  });

  const branches = useQuery({
    queryKey: ['login-branches', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<Branch>(
        'SELECT * FROM branch WHERE organization_id = ? AND active = 1 ORDER BY name',
        [orgId],
      ),
  });

  const selectedUser = users.data?.find((u) => u.id === userId);
  const requiresPassword = selectedUser?.has_password === 1;

  // Limpiar contraseña al cambiar usuario.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPassword('');
    setError('');
  }, [userId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleEnter() {
    if (!orgId || !userId || !branchId) {
      setError('Seleccioná organización, usuario y sucursal.');
      return;
    }
    if (requiresPassword && !password) {
      setError('Ingresá tu contraseña.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // En producción: autenticar contra el Worker (setea cookie httpOnly).
      // En dev: el Worker no corre, pero el flujo igual funciona porque la SPA
      // ya está autenticada por la DB directa (dev bypass).
      if (!import.meta.env.DEV) {
        const res = await fetch('/api/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user_id: userId, org_id: orgId, branch_id: branchId, password }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? 'No se pudo iniciar sesión.');
          return;
        }
      }

      // Hidratar sesión local.
      const org = orgs.data?.find((o) => o.id === orgId);
      const user = selectedUser;
      const branch = branches.data?.find((b) => b.id === branchId);
      if (!org || !user || !branch) {
        setError('Seleccioná organización, usuario y sucursal.');
        return;
      }
      setSession({ organization: org, user, branch });
      navigate(ROUTES.dashboard, { replace: true });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'No se pudo conectar.',
      );
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !!orgId &&
    !!userId &&
    !!branchId &&
    (!requiresPassword || password.length >= 1);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card gold className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Scissors className="h-8 w-8 text-gold-300" />
          <h1 className="brand-script text-5xl">{APP_NAME}</h1>
          <p className="text-sm text-white/50">Gestión multi-sucursal</p>
        </div>

        <div className="space-y-4">
          <Select
            label="Organización"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {orgs.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>

          <Select
            label="Usuario"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={!orgId}
          >
            <option value="">Seleccionar…</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} · {u.role}
              </option>
            ))}
          </Select>

          <Select
            label="Sucursal"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            disabled={!orgId}
          >
            <option value="">Seleccionar…</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>

          {requiresPassword && (
            <div className="relative">
              <Input
                label="Contraseña"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && canSubmit && void handleEnter()}
                autoComplete="current-password"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-9 text-white/40 hover:text-white"
                tabIndex={-1}
              >
                {showPwd ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          )}

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
