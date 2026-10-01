import { Merge, TriangleAlert, UserCheck, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui';
import { customerName } from '@/lib/format';

/** Lo mínimo para nombrar al dueño del número. */
export interface PhoneOwner {
  id: string;
  first_name: string;
  last_name: string | null;
  nickname?: string | null;
}

/**
 * Ese WhatsApp ya es de otra ficha.
 *
 * El aviso no es solo un error: casi siempre el número está bien y lo que está
 * mal es que hay dos fichas de la misma persona (una entra al reservar o al
 * importar la agenda de Google, incompleta, y la otra desde Clientes). Por eso
 * trae la salida al lado del problema, sin borrar lo que se acabó de escribir:
 *
 * - `onMerge`: hay dos fichas → combinarlas en una (se conserva el historial de
 *   las dos y ganan los datos recién escritos).
 * - `onUse`: todavía no hay segunda ficha (se estaba creando una, o la cita no
 *   tenía cliente) → usar la que existe y completarle los huecos.
 * - `onOpen`: abrir la otra ficha para mirarla antes de decidir.
 */
export function DuplicatePhoneNotice({
  owner,
  onMerge,
  onUse,
  onOpen,
  busy,
  renameTo,
  useHint = 'Usá esa ficha en vez de crear otra: le agregamos los datos que acabás de escribir y que le faltaban.',
}: {
  owner: PhoneOwner | null;
  onMerge?: () => void;
  onUse?: () => void;
  onOpen?: (id: string) => void;
  busy?: boolean;
  /**
   * Nombre con el que quedaría la ficha al usarla (lo que se escribió en el
   * formulario), cuando difiere del que tiene. Se dice en el botón: renombrar
   * es lo único que la acción pisa, así que tiene que verse antes de tocarlo.
   */
  renameTo?: string | null;
  /** Qué pasa al tocar "Usar ese contacto" (cambia según la pantalla). */
  useHint?: string;
}) {
  if (!owner) return null;
  const name = customerName(owner);

  return (
    <div className="space-y-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3">
      <div className="flex gap-2 text-sm">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
        <div className="min-w-0 space-y-1">
          <p className="text-danger">
            Ese número ya es de <b>{name}</b>.
          </p>
          {onMerge && (
            <p className="text-xs text-white/55">
              Si es la misma persona, combiná las dos fichas: se juntan las citas,
              ventas y notas de ambas, y quedan los datos que acabás de escribir.
            </p>
          )}
          {!onMerge && onUse && (
            <p className="text-xs text-white/55">{useHint}</p>
          )}
          {!onMerge && onUse && renameTo && (
            <p className="text-xs text-white/55">
              Queda como <b className="text-white/80">{renameTo}</b> y «{name}»
              pasa a ser su alias.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {onMerge && (
          <Button size="sm" loading={busy} onClick={onMerge}>
            <Merge className="h-4 w-4" /> Combinar fichas
          </Button>
        )}
        {onUse && (
          <Button
            size="sm"
            variant={onMerge ? 'outline' : 'gold'}
            loading={busy && !onMerge}
            onClick={onUse}
          >
            <UserCheck className="h-4 w-4" />{' '}
            {renameTo && !onMerge
              ? `Usar y renombrar a «${renameTo}»`
              : 'Usar ese contacto'}
          </Button>
        )}
        {onOpen && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpen(owner.id)}
          >
            <ExternalLink className="h-4 w-4" /> Abrir ficha
          </Button>
        )}
      </div>
    </div>
  );
}
