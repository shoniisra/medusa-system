import { NewSaleTab } from './NewSaleTab';

export function PosPage() {
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Punto de venta</h1>
      </div>

      <NewSaleTab />
    </div>
  );
}
