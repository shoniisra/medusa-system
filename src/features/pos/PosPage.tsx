import { NewSaleTab } from './NewSaleTab';

export function PosPage() {
  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Punto de venta</h1>
      </div>

      <NewSaleTab />
    </div>
  );
}
