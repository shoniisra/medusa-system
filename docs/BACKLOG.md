# Backlog priorizado — Medusa Estudio

Estado al 2026-09-24. Ordenado por impacto/esfuerzo. Marcá `[x]` al completar.

## ✅ Hecho en esta ronda
- [x] Agendar cita: quitar descuento, nombre completo de servicio, tiempos por
      servicio y total reservado, bloques por colaborador con aviso de conflicto.
- [x] Selector de cliente usable (autofocus, filtrado, alta inline solo WhatsApp).
- [x] Lista de clientes solo al escribir + scroll; fecha mínima hoy; horas cada
      30 min; chips de abono 5/10/20/otro; timeline visual de disponibilidad.
- [x] Fix de zona horaria Google Calendar (día corrido).
- [x] Personal: servicios del día por colaborador (valor + cliente).
- [x] Google event con abono en título/descripción.
- [x] Auto-agregar servicio al llenar servicio+estilista (sin botón).
- [x] Reasignar servicio entre colaboradoras (agendar y atender) + sync Google.
- [x] Vista calendario react-big-calendar + drag; navegación por días.
- [x] Dashboard: card financiero con tabs día/semana/mes + rediseño visual.
- [x] Pantalla de fichas de clientes (CRUD, métricas, historial, procesos color).
- [x] Code-splitting por ruta (bundle inicial 757kB → 377kB).

## 🔴 Alta prioridad
- [ ] **Seguridad de credenciales Turso**: el token viaja en el bundle (ver
      `src/lib/db.ts`). Mover escrituras a un backend/proxy o usar token de solo
      lectura + Edge Function para mutaciones. Bloqueante para producción.
- [ ] **Próximas citas en la ficha del cliente**: mostrar citas futuras además
      del historial facturado (tabla `appointment`).
- [ ] **Recordatorios de WhatsApp**: botón "recordar" en próximas citas que abra
      `wa.me` con mensaje precargado (confirmación de cita).
- [ ] **Validación de conflicto también al reprogramar por drag** en el calendario
      (hoy reprograma sin chequear solape).

## 🟡 Media prioridad
- [ ] Cumpleaños del mes en dashboard (usa `customer.birth_date`).
- [ ] Filtro por estilista/estado en la vista calendario.
- [ ] Exportar liquidación de nómina a CSV/PDF.
- [ ] Historial de color: adjuntar foto del resultado (requiere storage).
- [ ] Búsqueda global (clientes/servicios/citas) desde el header.
- [ ] Estados de carga/esqueleto consistentes en todas las pantallas.

## 🟢 Baja prioridad / futuro
- [ ] Modo offline real (cola de mutaciones + sync al reconectar).
- [ ] Multi-sucursal: selector y métricas comparativas.
- [ ] Roles y permisos por usuario (recepción vs admin).
- [ ] Herramienta de migraciones versionadas (hoy son scripts one-off).
- [ ] Tests (Vitest) para helpers de `schedule.ts` y cálculos de nómina.
- [ ] Mover `@types/react-big-calendar` a devDependencies.
