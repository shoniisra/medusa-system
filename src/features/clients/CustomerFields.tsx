import type { ReactNode } from 'react';
import { DateInput, EmailInput, Input, PhoneInput } from '@/components/ui';

/** Datos básicos de un contacto, tal como los edita el formulario. */
export type CustomerDraft = {
  firstName: string;
  lastName: string;
  nickname: string;
  importedName: string;
  phone: string;
  email: string;
  birth: string;
  /** Cédula o RUC (opcional). Para factura. */
  taxId: string;
};

export const EMPTY_CUSTOMER_DRAFT: CustomerDraft = {
  firstName: '',
  lastName: '',
  nickname: '',
  importedName: '',
  phone: '',
  email: '',
  birth: '',
  taxId: '',
};

/**
 * Campos del contacto: nombre real, alias, nombre de la agenda, WhatsApp, email
 * y cumpleaños.
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
      {/*
        Nombre y alias son dos cosas distintas y las dos hacen falta: arriba va
        el nombre real (identificar, facturar), acá cómo se le dice y con qué
        nombre está guardado en el teléfono. Ese último se completa solo en los
        contactos importados; se deja editable porque la agenda también cambia.
      */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Alias"
          placeholder="Como se le dice"
          value={draft.nickname}
          onChange={(e) => set('nickname', e.target.value)}
        />
        <Input
          label="Nombre en la agenda"
          placeholder="Como está en el teléfono"
          value={draft.importedName}
          onChange={(e) => set('importedName', e.target.value)}
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
        label="Cédula o RUC"
        placeholder="Opcional, para factura"
        value={draft.taxId}
        onChange={(e) => set('taxId', e.target.value)}
        inputMode="numeric"
      />
      <DateInput
        label="Cumpleaños"
        mode="birthday"
        value={draft.birth}
        onChange={(v) => set('birth', v)}
      />
    </>
  );
}
