import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryOne, execute } from '@/lib/db';
import { useOrgId } from '@/store/session';
import { invalidateCustomers } from '@/lib/queryClient';
import { Button, Card, CardHeader, DateInput, useToast } from '@/components/ui';
import { ColorRecordsCard } from './ColorRecordsCard';
import type { Customer } from '@/types';

/** Only mounted for the customer selected in an appointment or current sale. */
export function CustomerCareCard({ customerId, includeProcesses = true }: { customerId: string; includeProcesses?: boolean }) {
  const orgId = useOrgId();
  const customer = useQuery({
    queryKey: ['customer-care', orgId, customerId],
    queryFn: () => queryOne<Customer>(
      'SELECT * FROM customer WHERE organization_id = ? AND id = ?', [orgId, customerId],
    ),
  });
  return (
    <div className="space-y-4">
      {customer.isLoading && <p role="status">Cargando ficha capilar…</p>}
      {customer.isError && <p role="alert">No se pudo cargar la ficha capilar.</p>}
      {customer.data && <CareForm key={`${customer.data.id}:${customer.data.updated_at}`} customer={customer.data} />}
      {includeProcesses && <ColorRecordsCard key={customerId} customerId={customerId} />}
    </div>
  );
}

function CareForm({ customer }: { customer: Customer }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [birth, setBirth] = useState(customer.birth_date ?? '');
  const [hair, setHair] = useState(customer.hair_notes ?? '');
  const [allergies, setAllergies] = useState(customer.allergies ?? '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const save = useMutation({
    mutationFn: () => execute(
      `UPDATE customer SET birth_date = ?, hair_notes = ?, allergies = ?, notes = ?, updated_at = ?
        WHERE id = ? AND organization_id = ?`,
      [birth || null, hair.trim() || null, allergies.trim() || null, notes.trim() || null,
        new Date().toISOString(), customer.id, customer.organization_id],
    ),
    onSuccess: () => {
      invalidateCustomers(qc, customer.organization_id);
      for (const queryKey of [['customer-care'], ['customer-row'], ['appointment-head'], ['appt-customer-extras']]) {
        void qc.invalidateQueries({ queryKey });
      }
      toast.success('Ficha capilar guardada');
    },
    onError: (e: Error) => toast.error('No se pudo guardar la ficha', e.message),
  });
  return (
    <Card>
      <CardHeader title="Ficha capilar" subtitle="Datos del cliente de esta atención o venta" />
      <div className="space-y-3">
        <DateInput label="Cumpleaños" mode="birthday" value={birth} onChange={setBirth} />
        {[
          { label: 'Notas capilares', value: hair, set: setHair },
          { label: 'Alergias / sensibilidades', value: allergies, set: setAllergies },
          { label: 'Notas', value: notes, set: setNotes },
        ].map((field) => (
          <label key={field.label} className="block text-xs text-white/60">
            {field.label}
            <textarea className="input-base mt-1 w-full" rows={2} value={field.value}
              onChange={(e) => field.set(e.target.value)} />
          </label>
        ))}
        <Button loading={save.isPending} onClick={() => save.mutate()}>Guardar ficha capilar</Button>
      </div>
    </Card>
  );
}
