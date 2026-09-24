import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { query, queryOne } from '@/lib/db';
import { useSession } from '@/store/session';
import { APP_NAME, ROUTES } from '@/config/constants';
import { Button, Card, Select } from '@/components/ui';
import type { AppUser, Branch, Organization } from '@/types';

/**
 * Login MVP: selecciona organización, usuario y sucursal.
 * TODO: reemplazar por verificación real de credenciales (backend/proxy).
 */
export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);

  const [orgId, setOrgId] = useState('');
  const [userId, setUserId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState('');

  const orgs = useQuery({
    queryKey: ['orgs'],
    queryFn: () =>
      query<Organization>(
        'SELECT * FROM organization WHERE active = 1 ORDER BY name',
      ),
  });

  useEffect(() => {
    const def = import.meta.env.VITE_DEFAULT_ORG_ID;
    if (!orgId && def) setOrgId(def);
    else if (!orgId && orgs.data?.length) setOrgId(orgs.data[0].id);
  }, [orgs.data, orgId]);

  const users = useQuery({
    queryKey: ['login-users', orgId],
    enabled: !!orgId,
    queryFn: () =>
      query<AppUser>(
        'SELECT * FROM app_user WHERE organization_id = ? AND active = 1 ORDER BY full_name',
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

  async function handleEnter() {
    setError('');
    try {
      const org = await queryOne<Organization>(
        'SELECT * FROM organization WHERE id = ?',
        [orgId],
      );
      const user = users.data?.find((u) => u.id === userId);
      const branch = branches.data?.find((b) => b.id === branchId);
      if (!org || !user || !branch) {
        setError('Seleccioná organización, usuario y sucursal.');
        return;
      }
      setSession({ organization: org, user, branch });
      navigate(ROUTES.dashboard, { replace: true });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'No se pudo conectar a la base de datos.',
      );
    }
  }

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

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button
            className="w-full"
            size="lg"
            onClick={handleEnter}
            disabled={!orgId || !userId || !branchId}
          >
            Ingresar
          </Button>
        </div>
      </Card>
    </div>
  );
}
