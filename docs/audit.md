# Auditoría de citas, ventas, cobros, transacciones y clientes

La ruta `/auditoria` aparece en el menú de administración y gerencia. Permite
filtrar por módulo, acción, persona, fecha e identificador del registro. Cada
evento conserva el nombre y rol del autor en ese momento, fecha UTC, operación
común a todas las filas de un lote, tabla y fila afectadas, y valores antes y
después. La pantalla presenta las fechas en `America/Guayaquil`.

## Activación

1. Aplicar `npm run migrate -- docs/migrations/2026-10-17-audit-log.sql` antes de
   publicar el Worker y el frontend. La migración es reejecutable y no altera
   los datos existentes.
2. Publicar ambas partes juntas. Todos los usuarios deben volver a iniciar
   sesión: la versión 2 de la sesión local descarta sesiones anteriores.
3. Para desarrollo, reiniciar `npm run dev`: Vite ahora expone login, logout,
   escrituras y consulta de auditoría a través del mismo Worker.

Las fichas de cita, venta y cliente incluyen «Ver auditoría» para abrir el
historial filtrado de ese registro. Cobros y transacciones se consultan desde
el módulo de auditoría.

Si la cuenta admin no tenía token, una gerente puede entrar a **Equipo →
Miembros del equipo → Cuentas pendientes de token** y asignarle uno de cuatro
dígitos. Esa acción no habilita la edición de roles para gerencia.

El login siempre emite una cookie HttpOnly firmada. Se recomienda configurar
`SESSION_SECRET` como secreto independiente. Para instalaciones existentes que
no lo tienen, se usa una clave de firma con dominio separado basada en
`TURSO_AUTH_TOKEN`, que permanece en el servidor. Rotar cualquiera de esos
secretos invalida las sesiones. Los usuarios sin contraseña/PIN configurado
deben configurarlo antes de entrar; no se atribuyen escrituras a un usuario
sin verificar su credencial.

## Cobertura y garantías

- `app_audit_log` guarda el historial sin referencias con borrado en cascada;
  borrar un cliente o una venta conserva sus eventos.
- La tabla antigua `audit_log` y sus índices se conservan intactos. El nuevo
  historial tiene nombres propios para evitar conflictos con su esquema.
- `app_audit_context` contiene el autor únicamente dentro de la misma transacción
  de escritura. El contexto, las modificaciones y sus eventos se confirman o
  revierten juntos. No queda un autor residual para la siguiente petición.
- Los triggers cubren inserción, actualización y eliminación en `appointment`,
  `appointment_item`, `sale`, `sale_item`, `sale_service_staff`, `payment`,
  `cash_movement`, `cash_session`, `expense`, `account_transfer`, `debt_credit`,
  `staff_payment`, `staff_advance`, `customer`, `customer_color_record`,
  `customer_manicure_record` y `customer_credit_ledger`.
- Una actualización sin cambios reales no genera evento. Los cambios
  automáticos provocados por triggers también quedan registrados.
- El servidor obtiene al autor desde la cookie verificada y valida que esté
  activo. La consulta de auditoría comprueba el rol vigente y limita resultados
  a su organización, con paginación de 50 filas. No se cachean sus respuestas.
- El proxy de aplicación impide acceso SQL directo a las tablas de auditoría,
  cambios de esquema y manipulación de triggers. Los eventos no se pueden
  editar ni borrar mediante la aplicación. Administración de base de datos
  conserva sus privilegios fuera del proxy; no es un archivo firmado contra un DBA.
- Google Calendar se identifica como sistema: la integración no comunica la
  persona que editó el evento en Google. Las escrituras directas externas sin
  contexto se registran como «Sin identificar (escritura externa)», sin asignar
  automáticamente el valor de `created_by` como si fuera un autor verificado.
- No se reconstruye autoría histórica de cambios anteriores a la instalación.
  Las instantáneas reflejan las columnas del esquema al crear esta migración;
  al agregar columnas nuevas hay que actualizar sus triggers con otra migración.

## Verificación

`npm test` incluye SQLite real en archivos temporales para las 17 tablas,
rollback de lotes fallidos, retención de eventos tras eliminación, aislamiento
de autores, rechazo de manipulación, permisos de lectura, paginación y
separación por organización. Ninguna prueba modifica datos del salón.
