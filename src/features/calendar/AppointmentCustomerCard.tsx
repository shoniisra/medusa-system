import { useState, type ReactNode } from 'react';
import { CalendarClock, Cake, Hand, History, Palette, Pencil, ShieldAlert } from 'lucide-react';
import { Button, Card, Modal } from '@/components/ui';
import { dateShort, timeShort } from '@/lib/format';
import { birthdayCountdown, daysUntilBirthday } from '@/lib/date';
import { maskCustomerEmail, maskCustomerPhone } from '@/features/clients/contactPrivacy';
import { CustomerCareCard } from '@/features/clients/CustomerCareCard';
import { ColorRecordsCard, ManicureRecordsCard } from '@/features/clients/ColorRecordsCard';
import { CustomerHistoryCard, type CustomerHistory } from './CustomerHistoryCard';

type Client = {
  id: string | null; name: string | null; phone: string | null; email: string | null;
  allergies: string | null; hairNotes: string | null; birthDate: string | null;
};

/** Critical context stays visible above both the service editor and checkout. */
export function AppointmentCustomerCard({ customer, maskContact, onEditCustomer, dateLabel,
  startAt, endAt, duration, noteEditor, schedulingInfo, history, historyLoading, historyError,
}: {
  customer: Client; maskContact: boolean; onEditCustomer: () => void;
  dateLabel: ReactNode; startAt: string; endAt: string; duration: string | null;
  noteEditor: ReactNode; schedulingInfo: ReactNode;
  history: CustomerHistory | undefined; historyLoading: boolean; historyError: boolean;
}) {
  const [careOpen, setCareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const birthdayDays = daysUntilBirthday(customer.birthDate);
  return (
    <Card aria-label="Cliente y contexto de atención">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-white/40">Cliente</p>
          <h2 className="break-words text-xl font-semibold text-white">{customer.name ?? 'Sin cliente'}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 break-all text-xs text-white/45">
            {customer.phone && <span>{maskContact ? maskCustomerPhone(customer.phone) : customer.phone}</span>}
            {customer.email && <span>{maskContact ? maskCustomerEmail(customer.email) : customer.email}</span>}
            <button onClick={onEditCustomer} className="inline-flex items-center gap-1 font-medium text-gold-300 hover:underline">
              <Pencil className="h-3 w-3" />{customer.id ? 'Editar datos' : 'Agregar cliente'}
            </button>
          </div>
        </div>
        {customer.id && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/50">
          {birthdayDays != null && birthdayDays <= 30 && <span className="inline-flex items-center gap-1.5 text-gold-200"><Cake className="h-4 w-4" />Cumpleaños {birthdayCountdown(birthdayDays)}</span>}
          {historyLoading ? <span role="status">Cargando historial…</span>
            : historyError ? <span>No se pudo cargar el historial</span>
            : history && <span>{history.lastVisitAt ? `Última visita: ${dateShort(history.lastVisitAt)}` : 'Primera visita'}</span>}
          <button onClick={() => setHistoryOpen(true)} className="inline-flex items-center gap-1.5 text-gold-300 hover:underline">
            <History className="h-3.5 w-3.5" />Ver historial{history ? ` · ${history.visits} ${history.visits === 1 ? 'visita' : 'visitas'}` : ''}
          </button>
        </div>}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-white/10 pt-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
        <section aria-label="Cita de hoy" className="min-w-0 space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-gold-200"><CalendarClock className="h-4 w-4 shrink-0" />Cita de hoy</h3>
          <div className="space-y-1 text-xs text-white/60">
            <p className="first-letter:uppercase">{dateLabel}</p>
            <p>{timeShort(startAt)} – {timeShort(endAt)}</p>
            {duration && <p>Duración de servicios: <span className="text-white/80">{duration}</span></p>}
          </div>
          {noteEditor}
          <details className="text-xs text-white/40">
            <summary className="cursor-pointer hover:text-white/70">Datos del agendamiento</summary>
            <div className="mt-2 space-y-1">{schedulingInfo}</div>
          </details>
        </section>

        <section aria-label="Cuidados y precauciones" className="min-w-0 space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-gold-200"><ShieldAlert className="h-4 w-4 shrink-0" />Cuidados y precauciones</h3>
          {customer.allergies ? <div className="rounded-lg border border-danger/30 bg-danger/10 p-2.5">
            <p className="text-xs font-medium text-danger">Alergias / sensibilidades</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/85">{customer.allergies}</p>
          </div> : <p className="text-xs text-white/40">Sin alergias registradas.</p>}
          {customer.hairNotes ? <div>
            <p className="text-xs text-white/40">Cuidados del cabello</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/80">{customer.hairNotes}</p>
          </div> : <p className="text-xs text-white/40">Sin cuidados capilares registrados.</p>}
          {customer.id && <button onClick={() => setCareOpen(true)} className="text-xs text-gold-300 hover:underline">Editar cuidados y ficha</button>}
        </section>

        <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          {customer.id ? <ColorRecordsCard key={`color-${customer.id}`} customerId={customer.id} compact /> : <NoCustomerProcess title="Último color" icon={<Palette className="h-4 w-4" />} />}
        </div>
        <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          {customer.id ? <ManicureRecordsCard key={`manicure-${customer.id}`} customerId={customer.id} compact /> : <NoCustomerProcess title="Última manicura" icon={<Hand className="h-4 w-4" />} />}
        </div>
      </div>
      {customer.id && <>
        <Modal open={careOpen} onClose={() => setCareOpen(false)} title="Cuidados y ficha del cliente">
          <CustomerCareCard key={customer.id} customerId={customer.id} includeProcesses={false} />
        </Modal>
        <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Historial del cliente">
          {historyError ? <p role="alert" className="text-sm text-danger">No se pudo cargar el historial. Volvé a intentarlo al recargar la cita.</p>
            : <CustomerHistoryCard history={history} loading={historyLoading} />}
          <Button variant="outline" className="mt-4 w-full" onClick={() => setHistoryOpen(false)}>Cerrar historial</Button>
        </Modal>
      </>}
    </Card>
  );
}

function NoCustomerProcess({ title, icon }: { title: string; icon: ReactNode }) {
  return <section className="space-y-3"><h3 className="flex items-center gap-2 text-sm font-medium text-gold-200">{icon}{title}</h3><p className="text-xs text-white/40">Agregá un cliente para consultar o registrar sus procesos.</p></section>;
}
