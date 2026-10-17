import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { hasPermission } from '@/config/permissions';
import { ROUTES } from '@/config/constants';
import { useSession } from '@/store/session';

export function AuditHistoryLink({ entityType, id }: { entityType: string; id: string }) {
  const role = useSession((s) => s.user?.role);
  if (!id || !hasPermission(role, 'view_audit')) return null;
  const params = new URLSearchParams({ entity_type: entityType, entity_id: id });
  return <Link to={`${ROUTES.audit}?${params}`} className="inline-flex items-center gap-1.5 text-xs text-gold-300 hover:underline">
    <History className="h-3.5 w-3.5" /> Ver auditoría
  </Link>;
}
