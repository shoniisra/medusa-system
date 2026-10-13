/** Dona ingresos vs egresos. Verde = ingresos, rojo = egresos. */
export function Donut({
  income,
  expense,
  size = 64,
}: {
  income: number;
  expense: number;
  size?: number;
}) {
  const total = income + expense;
  const r = 26;
  const c = 2 * Math.PI * r;
  const incFrac = total > 0 ? income / total : 0;
  const expFrac = total > 0 ? expense / total : 0;
  const incLen = c * incFrac;
  const expLen = c * expFrac;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="shrink-0">
      {/* Fondo gris */}
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="9"
      />
      {total > 0 && (
        <>
          {/* Ingresos (verde) */}
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="rgb(52,211,153)"
            strokeWidth="9"
            strokeDasharray={`${incLen} ${c - incLen}`}
            strokeDashoffset={c / 4}
            transform="rotate(-90 32 32)"
          />
          {/* Egresos (rojo) - prosigue después del verde */}
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="rgb(244,63,94)"
            strokeWidth="9"
            strokeDasharray={`${expLen} ${c - expLen}`}
            strokeDashoffset={c / 4 - incLen}
            transform="rotate(-90 32 32)"
          />
        </>
      )}
    </svg>
  );
}
