import { KeyRound } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import type { UserRole } from '@/types';

export function PendingAccessPanel({ role, accounts, onSelect }: {
  role: UserRole | undefined;
  accounts: { userId: string; name: string; hasPassword: boolean }[];
  onSelect: (userId: string) => void;
}) {
  const pending = accounts.filter((account) => !account.hasPassword);
  if (role !== 'manager' || pending.length === 0) return null;
  return <Card>
    <p className="font-medium">Cuentas pendientes de token</p>
    <p className="mt-1 text-sm text-white/50">Asigná un token de 4 dígitos para que estas personas puedan iniciar sesión y sus cambios queden identificados.</p>
    <div className="mt-3 space-y-2">{pending.map((account) => <div key={account.userId} className="flex items-center justify-between gap-3">
      <span className="text-sm">{account.name}</span>
      <Button size="sm" variant="outline" onClick={() => onSelect(account.userId)}><KeyRound className="h-4 w-4" /> Asignar token</Button>
    </div>)}</div>
  </Card>;
}
