import { useState } from 'react';
import { NewSaleTab } from './NewSaleTab';
import { CollectTab } from './CollectTab';
import { cn } from '@/lib/cn';

type Tab = 'sale' | 'collect';

export function PosPage() {
  const [tab, setTab] = useState<Tab>('sale');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Punto de venta</h1>
      </div>

      <div className="flex gap-1 rounded-xl bg-ink-800/60 p-1">
        <TabButton active={tab === 'sale'} onClick={() => setTab('sale')}>
          Nueva venta
        </TabButton>
        <TabButton active={tab === 'collect'} onClick={() => setTab('collect')}>
          Cobros / abonos
        </TabButton>
      </div>

      {tab === 'sale' ? <NewSaleTab /> : <CollectTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-lg py-2 text-sm font-medium transition-colors',
        active ? 'bg-gold-400 text-ink-950' : 'text-white/60 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}
