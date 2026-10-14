import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import { query } from '@/lib/db';
import { useOrgId, useSession } from '@/store/session';
import { money } from '@/lib/format';
import { PageHeader, EmptyState, Badge } from '@/components/ui';

interface MyServiceRow {
  sale_id: string;
  sold_at: string;
  description: string;
  quantity: number;
  line_total: number;
  participation_role: 'primary' | 'assistant';
  commission_amount: number;
  assist_label: string | null;
  customer_name: string | null;
  sale_number: string;
  sale_status: string;
}

interface MyServicesSummary {
  services_count: number;
  total_commissions: number;
}

function useMyServices(staffMemberId: string | null) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['my-services', staffMemberId, orgId],
    enabled: !!staffMemberId && !!orgId,
    refetchInterval: 2 * 60 * 1000,
    queryFn: () =>
      query<MyServiceRow>(
        `SELECT
            s.id              AS sale_id,
            s.sold_at,
            s.sale_number,
            s.status          AS sale_status,
            si.description,
            si.quantity,
            si.line_total,
            sss.participation_role,
            sss.commission_amount,
            sss.assist_label,
            CASE
              WHEN c.nickname IS NOT NULL THEN c.nickname
              WHEN c.first_name IS NOT NULL THEN c.first_name || COALESCE(' ' || c.last_name, '')
              ELSE 'Consumidor Final'
            END AS customer_name
           FROM sale_service_staff sss
           JOIN sale_item si ON si.id = sss.sale_item_id
           JOIN sale s       ON s.id  = si.sale_id
           LEFT JOIN customer c ON c.id = s.customer_id
          WHERE sss.staff_member_id = ?
            AND s.organization_id   = ?
            AND s.status != 'voided'
            AND date(s.sold_at, 'localtime') = date('now', 'localtime')
          ORDER BY s.sold_at ASC`,
        [staffMemberId, orgId],
      ),
  });
}

function useMyStaffMember() {
  const userId = useSession((s) => s.user?.id);
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['my-staff-member', userId, orgId],
    enabled: !!userId && !!orgId,
    queryFn: () =>
      query<{ id: string }>(
        `SELECT id FROM staff_member WHERE app_user_id = ? AND organization_id = ? AND active = 1 LIMIT 1`,
        [userId!, orgId],
      ).then((rows) => rows[0] ?? null),
  });
}

function computeSummary(rows: MyServiceRow[]): MyServicesSummary {
  return {
    services_count: rows.length,
    total_commissions: rows.reduce((acc, r) => acc + r.commission_amount, 0),
  };
}

export function MyServicesPage() {
  const navigate = useNavigate();
  const { data: staffMember, isLoading: loadingStaff } = useMyStaffMember();
  const staffMemberId = staffMember?.id ?? null;

  const { data: rows = [], isLoading: loadingRows } = useMyServices(staffMemberId);
  const summary = computeSummary(rows);

  const isLoading = loadingStaff || loadingRows;

  if (!loadingStaff && !staffMember) {
    return (
      <div className="p-6">
        <PageHeader title="Mis servicios del día" onBack={() => navigate(-1)} />
        <EmptyState
          title="Sin perfil de colaboradora"
          description="Tu usuario no está vinculado a ninguna colaboradora. Pedile al admin que lo configure en Configuración → Personal."
          icon={Star}
        />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title="Mis servicios del día" onBack={() => navigate(-1)} />

      {/* Resumen del día */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
          <p className="text-2xl font-bold text-gold-200">{summary.services_count}</p>
          <p className="mt-1 text-xs text-white/50">Servicios</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
          <p className="text-2xl font-bold text-success">{money(summary.total_commissions)}</p>
          <p className="mt-1 text-xs text-white/50">Comisión del día</p>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <EmptyState
          title="Sin servicios hoy"
          description="Cuando atiendas clientes, tus servicios del día aparecerán acá."
          icon={Star}
        />
      )}

      {!isLoading && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div
              key={`${row.sale_id}-${i}`}
              className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-white">{row.description}</p>
                <p className="mt-0.5 text-sm text-white/50">
                  {row.customer_name}
                  {row.assist_label && (
                    <span className="ml-2 text-white/30">· {row.assist_label}</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-sm font-semibold text-success">
                  +{money(row.commission_amount)}
                </span>
                <Badge
                  tone={row.participation_role === 'primary' ? 'gold' : 'muted'}
                >
                  {row.participation_role === 'primary' ? 'Principal' : 'Ayudante'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
