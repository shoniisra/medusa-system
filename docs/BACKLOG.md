# Backlog priorizado — Medusa Estudio

Estado al 2026-09-24. Ordenado por impacto/esfuerzo. Marcá `[x]` al completar.

## ✅ Hecho — ronda integridad financiera + seña + recordatorios (2026-09-24)
- [x] **Anti-doble-venta**: en cita atendida se oculta "Confirmar Venta" y el
      modal revalida el estado en DB antes de vender.
- [x] **Venta ↔ cita**: `createSale` setea `sale.appointment_id` (trazabilidad).
- [x] **Ingreso manual tipado**: "Otro ingreso" con motivo obligatorio; el resumen
      separa Ventas (pago con venta) de Otros ingresos (sin venta).
- [x] **Anular venta**: pasa venta+pagos a `voided`, revierte el efectivo con un
      `cash_movement` de salida y devuelve la cita a "Atendiendo".
- [x] **Comisión configurable**: resolver lee `staff_service_commission` (vigencia
      + fallback 40%), usado en atención y POS; UI en Settings → Comisiones.
- [x] **POS unificado**: comparte `createSale` y las mismas reglas de comisión.
- [x] **Seña/abono**: se cobra al reservar (transferencia a cuenta principal o
      efectivo), no reembolsable; al cerrar la venta cobra total − seña y la
      re-atribuye a la venta.
- [x] **Panel Recordatorios de mañana**: ruta `/recordatorios` con contador,
      botón que abre WhatsApp Web con mensaje personalizado (bloqueado si el
      teléfono no es válido) y "marcar recordado".

## ✅ Hecho — rondas anteriores
- [x] Agendar cita: nombre completo de servicio, tiempos por servicio y total
      reservado, bloques por colaborador con aviso de conflicto.
- [x] Selector de cliente usable (autofocus, filtrado, alta inline).
- [x] Timeline visual de disponibilidad; chips de abono 5/10/20/otro.
- [x] Fix de zona horaria Google Calendar; sync de reasignación de colaborador.
- [x] Personal: servicios del día por colaborador; liquidación de comisiones.
- [x] Tablero de Tareas (Trello) independiente + citas vencidas con contador.
- [x] Vista calendario react-big-calendar + drag; reprogramación con conflicto.
- [x] Dashboard: card financiero con tabs día/semana/mes; cumpleaños del mes.
- [x] Fichas de clientes (CRUD, métricas, historial, procesos de color).
- [x] Próximas citas en la ficha del cliente.
- [x] Code-splitting por ruta.

## 🔴 Alta prioridad
- [ ] **Seguridad de credenciales Turso**: el token viaja en el bundle
      (`src/lib/db.ts`). Mover escrituras a un backend/proxy o token de solo
      lectura + Edge Function para mutaciones. Bloqueante para producción.
- [ ] **Facturación electrónica SRI + IVA**: hoy `tax_total` siempre 0 y
      "Facturación" solo trackea pedidos (no emite comprobante). Definir régimen,
      cálculo de IVA (15%) y emisión/XML SRI.
- [ ] **Inventario / stock de productos**: vender producto no descuenta stock;
      falta control de existencias, costo y alertas de reposición.

## 🟡 Media prioridad
- [ ] **Reportes de negocio**: ticket promedio, ventas por servicio/colaborador,
      tasa de recompra (rebooking), retención, y exportación CSV/PDF.
- [ ] **Propinas** en el cobro (asignables al colaborador, fuera de comisión).
- [ ] **Paquetes / bonos / gift cards / membresías / fidelidad** (puntos).
- [ ] **Cierre de caja con arqueo** por denominaciones + reporte Z.
- [ ] **Reserva online / autoagenda**: link público para que el cliente reserve
      (con seña) sin llamar.
- [ ] **Auditoría**: registro de quién anuló venta, cambió precio o cerró caja.
- [ ] Filtro por estilista/estado en la vista calendario.
- [ ] Exportar liquidación de nómina a CSV/PDF.
- [ ] Historial de color: adjuntar foto del resultado (requiere storage).
- [ ] Búsqueda global (clientes/servicios/citas) desde el header.
- [ ] Estados de carga/esqueleto consistentes en todas las pantallas.

## 🟢 Baja prioridad / futuro
- [ ] **Automatización real de WhatsApp** (recordatorios sin intervención):
      requiere backend + WhatsApp Business API.
- [ ] Modo offline real (cola de mutaciones + sync al reconectar).
- [ ] Multi-sucursal: selector y métricas comparativas.
- [ ] Roles y permisos por usuario (recepción vs admin) aplicados en acciones
      sensibles (anular, cerrar caja, ver finanzas).
- [ ] Herramienta de migraciones versionadas (hoy el esquema vive en Turso).
- [ ] Tests (Vitest) para helpers de `schedule.ts`, comisiones y nómina.
