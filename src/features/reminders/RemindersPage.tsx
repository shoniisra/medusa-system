import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Check, BellRing } from 'lucide-react';
import { query } from '@/lib/db';
import { useBranchId } from '@/store/session';
import { timeShort, dateShort } from '@/lib/format';
import { APPOINTMENT_STATUS } from '@/config/constants';
import { Card, CardHeader, Badge, Button, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { AppointmentStatus } from '@/types';

interface ReminderRow {
  id: string;
  start_at: string;
  status: AppointmentStatus;
  customer_name: string | null;
  phone: string | null;
  services: string | null;
}

/** "YYYY-MM-DD" de mañana (hora local). */
function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizePhone(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = '593' + d.slice(1);
  else if (!d.startsWith('593')) d = '593' + d;
  return d;
}

/** Número válido: al menos 9 dígitos (celular EC = 10 con el 0 inicial). */
function isValidPhone(phone: string | null): boolean {
  if (!phone) return false;
  return phone.replace(/\D/g, '').length >= 9;
}

/** Enlace a WhatsApp Web con mensaje personalizado precargado. */
function waReminder(phone: string, name: string | null, startAt: string): string {
  const saludo = name ? `Hola ${name.split(' ')[0]}` : 'Hola';
  const text = `${saludo} 👋 Te recordamos tu cita en Medusa Estudio el ${dateShort(
    startAt,
  )} a las ${timeShort(startAt)}. ¿La confirmás? 💇`;
  return `https://web.whatsapp.com/send?phone=${normalizePhone(
    phone,
  )}&text=${encodeURIComponent(text)}`;
}

/** Ids ya recordados (por día), guardados por dispositivo. */
function loadReminded(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function RemindersPage() {
  const branchId = useBranchId();
  const day = tomorrowYmd();
  const storeKey = `reminded:${day}`;

  const [reminded, setReminded] = useState<Set<string>>(() =>
    loadReminded(storeKey),
  );

  const toggleReminded = (id: string) => {
    setReminded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(storeKey, JSON.stringify([...next]));
      } catch {
        /* modo privado / almacenamiento bloqueado: se ignora */
      }
      return next;
    });
  };

  const q = useQuery({
    queryKey: ['reminders', branchId, day],
    enabled: !!branchId,
    queryFn: () =>
      query<ReminderRow>(
        `SELECT a.id, a.start_at, a.status,
                c.first_name || CASE WHEN c.last_name IS NOT NULL THEN ' ' || c.last_name ELSE '' END AS customer_name,
                c.phone,
                (SELECT GROUP_CONCAT(ai.description, ', ')
                   FROM appointment_item ai WHERE ai.appointment_id = a.id) AS services
           FROM appointment a
           LEFT JOIN customer c ON c.id = a.customer_id
          WHERE a.branch_id = ?
            AND a.status IN ('reserved','confirmed')
            AND substr(a.start_at, 1, 10) = ?
          ORDER BY a.start_at`,
        [branchId, day],
      ),
  });

  const rows = q.data ?? [];
  const pending = useMemo(
    () => rows.filter((r) => !reminded.has(r.id)).length,
    [rows, reminded],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Recordatorios de mañana
          </h1>
          <p className="text-sm text-white/40">{dateShort(`${day}T00:00`)}</p>
        </div>
        {rows.length > 0 && (
          <Badge tone={pending > 0 ? 'gold' : 'success'}>
            {pending > 0 ? `${pending} por avisar` : 'Todos avisados'}
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader
          title="Citas de mañana"
          subtitle="Avisá por WhatsApp y marcá las que ya recordaste"
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={BellRing}
            title="Sin citas para mañana"
            description="No hay reservas para el día siguiente."
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((a) => {
              const meta = APPOINTMENT_STATUS[a.status];
              const done = reminded.has(a.id);
              return (
                <li
                  key={a.id}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-xl border p-3',
                    done
                      ? 'border-emerald-400/20 bg-emerald-400/5'
                      : 'border-white/10 bg-white/5',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="text-center">
                      <p className="kpi-gold text-sm">{timeShort(a.start_at)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {a.customer_name ?? 'Sin cliente'}
                      </p>
                      <p className="truncate text-xs text-white/40">
                        {a.services ?? 'Sin servicios'}
                        {isValidPhone(a.phone) ? '' : ' · sin WhatsApp válido'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isValidPhone(a.phone)}
                      title={
                        isValidPhone(a.phone)
                          ? 'Abrir WhatsApp Web con el recordatorio'
                          : 'Número de teléfono no válido'
                      }
                      className="text-emerald-300"
                      onClick={() =>
                        window.open(
                          waReminder(a.phone!, a.customer_name, a.start_at),
                          '_blank',
                          'noopener,noreferrer',
                        )
                      }
                    >
                      <MessageCircle className="h-4 w-4" /> Recordar
                    </Button>
                    <Button
                      size="sm"
                      variant={done ? 'gold' : 'ghost'}
                      onClick={() => toggleReminded(a.id)}
                    >
                      <Check className="h-4 w-4" />
                      {done ? 'Recordado' : 'Marcar'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
