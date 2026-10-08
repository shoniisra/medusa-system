import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { execute } from '@/lib/db';
import { Button, Modal, useToast } from '@/components/ui';
import { customerName, fullName, genId } from '@/lib/format';
import { invalidateCustomers } from '@/lib/queryClient';
import { normalizeEmail, validateEmail } from '@/lib/email';
import { validatePhone } from '@/lib/phone';
import { findCustomerByPhone } from './customerLookup';
import { CustomerFields, type CustomerDraft } from './CustomerFields';
import { DuplicatePhoneNotice } from './DuplicatePhoneNotice';
import type { Customer } from '@/types';

/**
 * Modal "completar más datos" para un cliente que se está creando desde el
 * alta rápida (POS, Agendar). Idéntico al modal de datos del cliente de la
 * cita en forma, pero crea el contacto en el acto en vez de atarlo a una cita
 * existente.
 */
export function QuickCustomerModal({
  orgId,
  initial,
  onClose,
  onCreated,
}: {
  orgId: string;
  initial: { firstName: string; lastName: string; phone: string };
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<CustomerDraft>({
    firstName: initial.firstName,
    lastName: initial.lastName,
    nickname: '',
    importedName: '',
    phone: initial.phone,
    email: '',
    birth: '',
    taxId: '',
  });
  const [owner, setOwner] = useState<Customer | null>(null);
  const [error, setError] = useState('');

  const set = <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => {
    if (key === 'phone') {
      setOwner(null);
      setError('');
    }
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const save = useMutation({
    mutationFn: async (): Promise<Customer> => {
      const name = draft.firstName.trim();
      if (!name) throw new Error('El nombre del cliente es obligatorio.');
      const canonical = draft.phone.trim() || null;
      const phoneError = validatePhone(canonical);
      if (phoneError) throw new Error(phoneError);
      const email = normalizeEmail(draft.email);
      const emailError = validateEmail(email);
      if (emailError) throw new Error(emailError);
      if (canonical) {
        const hit = await findCustomerByPhone(orgId, canonical);
        if (hit) {
          const err = new Error(
            `Ese número ya es de ${customerName(hit)}.`,
          ) as Error & { hit?: Customer };
          err.hit = hit;
          throw err;
        }
      }
      const id = genId();
      const now = new Date().toISOString();
      await execute(
        `INSERT INTO customer
           (id, organization_id, first_name, last_name, nickname, imported_name,
            phone, email, birth_date, tax_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          orgId,
          name,
          draft.lastName.trim() || null,
          draft.nickname.trim() || null,
          draft.importedName.trim() || null,
          canonical,
          email || null,
          draft.birth || null,
          draft.taxId.trim() || null,
        ],
      );
      return {
        id,
        organization_id: orgId,
        first_name: name,
        last_name: draft.lastName.trim() || null,
        nickname: draft.nickname.trim() || null,
        imported_name: draft.importedName.trim() || null,
        phone: canonical,
        email: email || null,
        birth_date: draft.birth || null,
        tax_id: draft.taxId.trim() || null,
        notes: null,
        allergies: null,
        hair_notes: null,
        preferred_staff_id: null,
        first_visit_at: null,
        last_visit_at: null,
        active: 1,
        created_at: now,
        updated_at: now,
      };
    },
    onSuccess: (row) => {
      invalidateCustomers(qc, orgId);
      toast.success('Cliente creado', customerName(row));
      onCreated(row);
    },
    onError: (e: Error & { hit?: Customer }) => {
      if (e.hit) {
        setOwner(e.hit);
        setError('');
        return;
      }
      const msg = e.message || 'No se pudo guardar el cliente.';
      setError(msg);
      toast.error('No se pudo guardar el cliente', msg);
    },
  });

  const useExisting = () => {
    if (owner) onCreated(owner);
  };

  return (
    <Modal open onClose={onClose} title="Datos del cliente">
      <div className="space-y-4">
        <CustomerFields
          draft={draft}
          set={set}
          notice={
            <DuplicatePhoneNotice
              owner={owner}
              busy={save.isPending}
              onUse={owner ? useExisting : undefined}
              useHint={`Usá esa ficha en vez de crear un contacto nuevo${
                owner ? ` (quedará como ${fullName(owner.first_name, owner.last_name)})` : ''
              }.`}
            />
          }
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button
          className="w-full"
          disabled={!draft.firstName.trim()}
          loading={save.isPending}
          onClick={() => {
            setError('');
            save.mutate();
          }}
        >
          <Check className="h-4 w-4" /> Guardar cliente
        </Button>
      </div>
    </Modal>
  );
}
