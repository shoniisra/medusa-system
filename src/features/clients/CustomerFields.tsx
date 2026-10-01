import type { ReactNode } from 'react';
import { EmailInput, Input, PhoneInput } from '@/components/ui';

/** Datos básicos de un contacto, tal como los edita el formulario. */
export type CustomerDraft = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  birth: string;
};

export const EMPTY_CUSTOMER_DRAFT: CustomerDraft = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  birth: '',
};

/**
 * Campos del contacto: nombre, apellido, WhatsApp, email y cumpleaños.
 *
 * Estaban copiados en las tres pantallas que editan un cliente (alta desde el
 * listado, ficha y cliente de la cita), así que agregar un campo significaba
 * tocar tres formularios. `notice` se dibuja justo debajo del teléfono: es donde
 * va el aviso de número duplicado o el error de validación.
 */
export function CustomerFields({
  draft,
  set,
  notice,
}: {
  draft: CustomerDraft;
  set: <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => void;
  notice?: ReactNode;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Nombre"
          value={draft.firstName}
          onChange={(e) => set('firstName', e.target.value)}
        />
        <Input
          label="Apellido"
          value={draft.lastName}
          onChange={(e) => set('lastName', e.target.value)}
        />
      </div>
      <PhoneInput
        label="WhatsApp"
        value={draft.phone}
        onChange={(v) => set('phone', v)}
      />
      {notice}
      <EmailInput
        label="Email"
        value={draft.email}
        onChange={(v) => set('email', v)}
      />
      <Input
        label="Cumpleaños"
        type="date"
        value={draft.birth}
        onChange={(e) => set('birth', e.target.value)}
      />
    </>
  );
}
