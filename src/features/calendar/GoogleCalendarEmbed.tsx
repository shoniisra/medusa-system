import { useQuery } from '@tanstack/react-query';
import { CalendarX } from 'lucide-react';
import { query } from '@/lib/db';
import { useBranchId } from '@/store/session';
import { DEFAULT_TIMEZONE } from '@/config/constants';
import { Card, EmptyState } from '@/components/ui';

/**
 * Muestra el calendario de Google de la sucursal activa embebido (solo lectura).
 * Requiere que la sucursal tenga `google_calendar_id` y que el calendario esté
 * compartido con —o sea público para— quien lo mira.
 */
export function GoogleCalendarEmbed({
  className = 'h-[600px]',
  mode = 'WEEK',
}: {
  className?: string;
  /** Vista del calendario embebido: día, semana, mes o agenda. */
  mode?: 'DAY' | 'WEEK' | 'MONTH' | 'AGENDA';
}) {
  const branchId = useBranchId();

  const branch = useQuery({
    queryKey: ['branch-calendar', branchId],
    enabled: !!branchId,
    queryFn: () =>
      query<{ google_calendar_id: string | null; name: string }>(
        'SELECT google_calendar_id, name FROM branch WHERE id = ?',
        [branchId],
      ),
  });

  const calId = branch.data?.[0]?.google_calendar_id?.trim();

  if (!calId) {
    return (
      <Card>
        <EmptyState
          icon={CalendarX}
          title="Sin calendario de Google en esta sede"
          description="Configurá el ID de Google Calendar en Configuración → Sucursales."
        />
      </Card>
    );
  }

  const src = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(
    calId,
  )}&ctz=${encodeURIComponent(DEFAULT_TIMEZONE)}&mode=${mode}`;

  return (
    <Card className="overflow-hidden p-0">
      <iframe
        title="Google Calendar"
        src={src}
        className={`w-full rounded-2xl border-0 ${className}`}
        loading="lazy"
      />
    </Card>
  );
}
