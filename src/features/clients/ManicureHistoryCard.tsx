import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hand, History } from 'lucide-react';
import { query } from '@/lib/db';
import { dateShort } from '@/lib/format';
import { useOrgId } from '@/store/session';
import { Button, Card, CardHeader, Modal } from '@/components/ui';
import { CustomerProcessRecordsCard } from './CustomerProcessRecordsCard';
import { MANICURE_SYSTEMS, manicureHistoryQuery, summarizeManicureHistory, type ManicureServiceRow, type ManicureVisit } from './manicureHistory';

/** The summary depends only on attended appointments, not on a manual technical record. */
export function ManicureHistoryCard({ customerId, compact = false, readOnly = false }: { customerId: string; compact?: boolean; readOnly?: boolean }) {
  const orgId = useOrgId();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const history = useQuery({
    queryKey: ['manicure-history', orgId, customerId],
    enabled: !!orgId && !!customerId,
    queryFn: async () => {
      const stmt = manicureHistoryQuery(orgId, customerId);
      return summarizeManicureHistory(await query<ManicureServiceRow>(stmt.sql, stmt.args));
    },
  });
  const latest = history.data?.visits[0];
  const Container = compact ? 'section' : Card;
  const title = compact ? 'Última manicura' : 'Historial de manicura';
  return (
    <Container className={compact ? 'min-w-0 space-y-3' : undefined} aria-label={title}>
      {compact ? <h3 className="flex items-center gap-2 text-sm font-medium text-gold-200"><Hand className="h-4 w-4 shrink-0" />{title}</h3>
        : <CardHeader title={title} subtitle="Detectado de los servicios de citas atendidas" />}
      {history.isLoading ? <p role="status" className="text-xs text-white/40">Consultando citas atendidas…</p>
        : history.isError ? <div role="alert" className="space-y-1 text-xs text-danger"><p>No se pudo consultar la última manicura.</p><button onClick={() => void history.refetch()} className="underline">Reintentar</button></div>
        : latest ? <>
          <VisitSummary visit={latest} compact />
          {!!history.data?.usual.length && <div className="rounded-lg bg-gold/[0.08] p-2.5">
            <p className="text-xs text-white/40">{history.data.usual.length > 1 ? 'Sistemas habituales' : 'Sistema habitual'}</p>
            {history.data.usual.map((usual) => <p key={usual.system} className="mt-1 text-sm text-gold-200">{MANICURE_SYSTEMS[usual.system]} <span className="text-xs text-white/50">· {usual.visits} citas</span></p>)}
          </div>}
          <p className="text-[11px] text-white/40">Detectado de citas atendidas</p>
        </> : <p className="text-xs text-white/40">Sin manicuras en citas atendidas.</p>}
      <div className="flex flex-wrap gap-3 text-xs">
        {!!history.data?.visits.length && <button onClick={() => setHistoryOpen(true)} className="inline-flex items-center gap-1 text-gold-300 hover:underline"><History className="h-3.5 w-3.5" />Ver historial ({history.data.visits.length})</button>}
        {!readOnly && <button onClick={() => setTechnicalOpen(true)} className="text-gold-300 hover:underline">Ficha técnica manual</button>}
      </div>
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Manicuras en citas atendidas">
        <ul className="space-y-4">{history.data?.visits.map((visit) => <li key={visit.appointmentId} className="rounded-xl border border-white/10 bg-white/[0.02] p-3"><VisitSummary visit={visit} /></li>)}</ul>
        <Button variant="outline" className="mt-4 w-full" onClick={() => setHistoryOpen(false)}>Cerrar historial</Button>
      </Modal>
      <Modal open={technicalOpen} onClose={() => setTechnicalOpen(false)} title="Ficha técnica de manicura">
        <p className="mb-4 text-xs text-white/50">Registro opcional de productos, tonos y cuidados. El sistema habitual se calcula automáticamente desde las citas atendidas.</p>
        <CustomerProcessRecordsCard customerId={customerId} kind="manicure" />
      </Modal>
    </Container>
  );
}

function VisitSummary({ visit, compact = false }: { visit: ManicureVisit; compact?: boolean }) {
  return <div className="space-y-2">
    <p className="text-xs text-white/50">{dateShort(visit.startAt)}{visit.staffNames.length > 0 && <span className="block">{visit.staffNames.join(', ')}</span>}</p>
    <div><p className="text-xs text-white/40">Sistema realizado</p><p className="mt-0.5 text-sm font-medium text-white/85">{visit.systems.length ? visit.systems.map((system) => MANICURE_SYSTEMS[system]).join(' + ')
      : visit.hasRemoval ? 'Solo retiro · sin aplicación de sistema registrada' : 'Sistema no especificado'}</p></div>
    {!!visit.finishes.length && <p className="text-xs text-white/60">Acabado: {visit.finishes.map((system) => MANICURE_SYSTEMS[system]).join(' + ')}</p>}
    {visit.hasRemoval && visit.systems.length > 0 && <p className="text-xs text-white/60">Retiro{visit.removedSystems.length ? ` de ${visit.removedSystems.map((system) => MANICURE_SYSTEMS[system]).join(' + ')}` : ''}</p>}
    <ul className={`space-y-1 whitespace-pre-wrap break-words text-xs text-white/50 ${compact ? 'line-clamp-2' : ''}`}>{visit.services.map((service) => <li key={service}>{service}</li>)}</ul>
  </div>;
}
