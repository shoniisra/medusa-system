# Medusa Estudio — Frontend PWA

SaaS multi-sucursal para gestión de salones de belleza. React + TypeScript + Vite,
Tailwind, PWA, Zustand, React Router, React Hook Form + Zod, TanStack Query y
libSQL (Turso).

## Puesta en marcha

```bash
npm install
cp .env.example .env   # completá VITE_TURSO_AUTH_TOKEN y VITE_DEFAULT_ORG_ID
npm run dev
```

- `npm run build` — typecheck + build de producción (genera el service worker).
- `npm run preview` — sirve el build.

> ⚠️ **Seguridad:** en una PWA el token de Turso viaja en el bundle. Para
> producción, mover las escrituras a un backend/proxy o usar tokens de solo
> lectura. La conexión directa (`src/lib/db.ts`) es para el MVP.

## Arquitectura (Feature Slices)

```
src/
 ├── assets/        # estáticos
 ├── components/ui/ # Button, Card, StatCard, Badge, Input, Modal, EmptyState
 ├── config/        # constantes, rutas, catálogos de estados
 ├── features/      # módulos de negocio (ver abajo)
 ├── layouts/       # AppLayout, Sidebar, Topbar, MobileNav
 ├── lib/           # db (Turso), format, cn, queryClient
 ├── routes/        # router + ProtectedRoute
 ├── store/         # Zustand: session, posDraft
 └── types/         # contrato de datos (espejo del esquema SQLite)
```

## Módulos

| Módulo | Ruta | Estado |
|---|---|---|
| Dashboard | `/` | Métricas del día por sucursal + estado de caja (usa las `v_daily_*`) |
| POS | `/pos` | Venta con distribución de comisiones (principal/ayudante) + cobros/abonos |
| Caja | `/caja` | Apertura/cierre de sesión + egresos (efectivo afecta caja, transferencia no) |
| Agenda | `/agenda` | Vista por día con estados de cita + alta rápida de cliente |
| Personal | `/personal` | Colaboradores, adelantos y liquidación por periodo |
| Facturación | `/facturacion` | Kanban Pendiente → En proceso → Hecho (usa `v_invoice_kanban`) |

## Reglas de negocio clave

- **Venta ≠ Pago.** La `sale` es lo que se cobra; los `payment` son ingresos de
  dinero. El saldo = `total − Σ pagos confirmados`. Los cobros se registran
  después de crear la venta (pestaña *Cobros*).
- **Comisiones fraccionadas.** Cada línea de servicio distribuye comisión a un
  `primary` y opcionalmente `assistant` (`sale_service_staff`), con tipo `%`/fijo.
- **Facturación por solicitud.** Una venta con `requires_invoice = 1` crea un
  `invoice_request` que entra al Kanban en *Pendiente*.
- **Contexto activo.** Dashboard y caja siempre filtran por la **sucursal** y la
  **sesión de caja** activas (`store/session.ts`).

## Base de datos

Esquema SQLite/Turso ya existente (Ecuador: SRI, USD, `America/Guayaquil`). Los
tipos en `src/types/index.ts` son espejo 1:1 de las tablas y vistas.
