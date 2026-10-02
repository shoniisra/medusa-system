import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Check, BellRing, Cake } from 'lucide-react';
import { query } from '@/lib/db';
import { useBranchId, useOrgId } from '@/store/session';
import { timeShort, dateShort } from '@/lib/format';
import {
  daysUntilBirthday,
  birthdayCountdown,
  birthdayDayMonth,
} from '@/lib/date';
import { phoneToWaDigits } from '@/lib/phone';
import { APPOINTMENT_STATUS } from '@/config/constants';
import { Card, CardHeader, Badge, Button, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { AppointmentStatus } from '@/types';
import { customerNameSql } from '@/features/clients/customerNameSql';

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
  return phoneToWaDigits(phone);
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

/** Enlace a WhatsApp Web con el saludo de cumpleaños precargado. */
function waBirthday(phone: string, name: string | null): string {
  const saludo = name ? `¡Feliz cumpleaños, ${name.split(' ')[0]}!` : '¡Feliz cumpleaños!';
  const text = `${saludo} 🎉 De parte de todo el equipo de Medusa Estudio. Te esperamos para consentirte 💇✨`;
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
                ${customerNameSql()} AS customer_name,
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

  // Referencia estable: sin esto el useMemo de abajo se recalcula siempre.
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const pending = useMemo(
    () => rows.filter((r) => !reminded.has(r.id)).length,
    [rows, reminded],
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
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

      <UpcomingBirthdays />
    </div>
  );
}

interface UpcomingBirthdayRow {
  id: string;
  name: string | null;
  phone: string | null;
  birth_date: string;
  kind: 'staff' | 'client';
}

/** Días dentro de los que se consideran "próximos" los cumpleaños. */
const BIRTHDAY_HORIZON = 30;

/** Cumpleañeros próximos: equipo y clientes, ordenados por cercanía. */
function UpcomingBirthdays() {
  const orgId = useOrgId();
  const now = new Date();
  // Ventana de 30 días: nunca cruza más de dos meses.
  const m1 = String(now.getMonth() + 1).padStart(2, '0');
  const m2 = String(((now.getMonth() + 1) % 12) + 1).padStart(2, '0');

  const q = useQuery({
    queryKey: ['upcoming-birthdays', orgId, m1],
    enabled: !!orgId,
    queryFn: () =>
      query<UpcomingBirthdayRow>(
        `SELECT id, ${customerNameSql('customer')} AS name, phone, birth_date,
                'client' AS kind
           FROM customer
          WHERE organization_id = ? AND active = 1 AND birth_date IS NOT NULL
            AND substr(birth_date,6,2) IN (?, ?)
         UNION ALL
         SELECT id, trim(first_name || ' ' || COALESCE(last_name, '')) AS name,
                phone, birth_date, 'staff' AS kind
           FROM staff_member
          WHERE organization_id = ? AND active = 1 AND birth_date IS NOT NULL`,
        [orgId, m1, m2, orgId],
      ),
  });

  const upcoming = useMemo(() => {
    return (q.data ?? [])
      .map((r) => ({ ...r, days: daysUntilBirthday(r.birth_date) }))
      .filter(
        (r): r is UpcomingBirthdayRow & { days: number } =>
          r.days != null && r.days <= BIRTHDAY_HORIZON,
      )
      .sort((a, b) => a.days - b.days || (a.kind === b.kind ? 0 : a.kind === 'staff' ? -1 : 1));
  }, [q.data]);

  return (
    <Card>
      <CardHeader
        title="Cumpleañeros próximos"
        subtitle={`Equipo y clientes que cumplen en los próximos ${BIRTHDAY_HORIZON} días`}
      />
      {upcoming.length === 0 ? (
        <EmptyState
          icon={Cake}
          title="Sin cumpleaños próximos"
          description="Nadie cumple años en los próximos días."
        />
      ) : (
        <ul className="space-y-2">
          {upcoming.map((b) => {
            const soon = b.days === 0;
            return (
              <li
                key={`${b.kind}-${b.id}`}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-xl border p-3',
                  soon
                    ? 'border-gold-400/40 bg-gold-400/10'
                    : 'border-white/10 bg-white/5',
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Cake
                    className={cn(
                      'h-4 w-4 shrink-0',
                      soon ? 'text-gold-300' : 'text-white/30',
                    )}
                  />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-white">
                      {b.name ?? 'Sin nombre'}
                      {b.kind === 'staff' && <Badge tone="gold">Equipo</Badge>}
                    </p>
                    <p className="truncate text-xs text-white/40">
                      {birthdayDayMonth(b.birth_date)} · {birthdayCountdown(b.days)}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isValidPhone(b.phone)}
                  title={
                    isValidPhone(b.phone)
                      ? 'Abrir WhatsApp Web con el saludo'
                      : 'Número de teléfono no válido'
                  }
                  className="shrink-0 text-emerald-300"
                  onClick={() =>
                    window.open(
                      waBirthday(b.phone!, b.name),
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  <MessageCircle className="h-4 w-4" /> Saludar
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
