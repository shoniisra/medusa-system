# Prompt de configuración (Claude en el navegador)

Copiá y pegá esto en Claude con navegación. Reemplazá lo que está entre `<< >>`.

---

Necesito configurar un webhook seguro para sincronizar Google Calendar con mi
sistema. El sistema está en Cloudflare (Worker `medusa-system`, dominio
`admin.medusa-estudio.com`) y todo el host está detrás de Cloudflare Access.
Voy a autenticar el webhook con un **service token de Access** + un **secreto
compartido**. Guiame paso a paso, pausando para que yo copie valores sensibles.

Datos fijos:
- URL del webhook: `https://admin.medusa-estudio.com/api/gcal-sync`
- ID del calendario: `7de4355ad35f4d661eb12b0527ac5e7ca90b297c4b4ee80ab3cfc16a3405a64c@group.calendar.google.com`
- Zona horaria: America/Guayaquil

## Paso 1 — Secreto compartido del Worker (Cloudflare Dashboard)
1. Andá a **Cloudflare → Workers & Pages → medusa-system → Settings → Variables and Secrets**.
2. Agregá una variable **cifrada (Secret)** llamada `GCAL_SYNC_SECRET` con un valor
   aleatorio largo (generá uno de 40+ caracteres). **Anotá ese valor**, lo reusamos en Apps Script.
3. Guardá y **redesplegá** el Worker si el panel lo pide.

## Paso 2 — Service Token de Access (Cloudflare Zero Trust)
1. Andá a **Zero Trust → Access → Service Auth → Service Tokens → Create Service Token**.
2. Nombre: `apps-script-gcal`. Creá.
3. **Copiá inmediatamente** el **Client ID** y el **Client Secret** (el secret se
   muestra una sola vez). Guardámelos para el Paso 4.

## Paso 3 — Aplicación de Access para la ruta del webhook (Zero Trust)
El host entero ya está protegido por Access con login por correo. Para que una
máquina pueda llamar SOLO a `/api/gcal-sync`, creamos una app más específica para
esa ruta que acepte el service token:
1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Application name: `Medusa gcal webhook`.
3. En **Application domain**: subdominio `admin`, dominio `medusa-estudio.com`,
   **path** = `api/gcal-sync`.
4. Guardá y agregá una **policy**:
   - Action: **Service Auth**.
   - Nombre: `Solo apps-script`.
   - Include → selector **Service Token** → elegí `apps-script-gcal`.
5. Guardá la aplicación. (Access evalúa la ruta más específica primero, así que
   `/api/gcal-sync` queda gobernada por esta app y el resto del sitio sigue con login por correo.)

## Paso 4 — Proyecto de Google Apps Script
1. Andá a **script.google.com** con la cuenta Gmail dueña del calendario y creá un
   proyecto nuevo: `Medusa GCal Sync`.
2. Pegá el contenido del archivo `docs/gcal-sync.gs` del repo en `Código.gs`.
3. **Servicios (＋)** → agregá **Google Calendar API** (identificador `Calendar`).
4. **Configuración del proyecto → Propiedades del script** → agregá:
   - `WORKER_URL` = `https://admin.medusa-estudio.com/api/gcal-sync`
   - `CALENDAR_ID` = `7de4355ad35f4d661eb12b0527ac5e7ca90b297c4b4ee80ab3cfc16a3405a64c@group.calendar.google.com`
   - `GCAL_SECRET` = *(el mismo valor del Paso 1)*
   - `CF_ACCESS_CLIENT_ID` = *(Client ID del Paso 2)*
   - `CF_ACCESS_CLIENT_SECRET` = *(Client Secret del Paso 2)*
5. Seleccioná la función **`setUp`** y ejecutála. Autorizá los permisos que pida
   (Calendar + conexión externa).
6. Revisá **Ejecuciones**: debe verse `Worker OK: {...}` sin errores.

## Paso 5 — Verificación
1. Creá un evento de prueba en el calendario (ej. "Prueba Ana lifting $10", con un
   color asignado a una estilista). Esperá 1–2 min.
2. Confirmá que aparezca en la agenda del sistema.
3. (Opcional) Un `GET`/`POST` a `https://admin.medusa-estudio.com/api/gcal-sync`
   sin el service token debe devolver bloqueo de Access o 401 — eso confirma que
   la ruta no quedó abierta.

Cuando termines, resumime qué quedó configurado y cualquier valor que deba guardar
en un gestor de contraseñas.
