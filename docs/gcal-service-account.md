# Google Calendar con service account (sistema → Google)

## Por qué

El flujo anterior usaba Google Identity Services **en el navegador**: cada
usuaria que agendaba tenía que iniciar sesión con su cuenta de Google y chocaba
con *"la app está en modo de prueba"*. Eso pasa porque la pantalla de
consentimiento está en estado **Testing** (solo autorizan los correos agregados
como test users), y publicarla no alcanza: `calendar.events` es un **scope
sensible** y Google exige verificación de la app.

El calendario es **del salón**, no de cada usuaria, así que no hay razón para
autenticar por persona. Ahora una sola identidad de servidor escribe en los
calendarios y **el único login de la app es Cloudflare Access**.

## Cómo quedó

| Dirección | Quién lo hace | Ruta |
|---|---|---|
| Google → sistema | Apps Script del calendario | `POST /api/gcal-sync` ([worker/gcalSync.ts](../worker/gcalSync.ts)) |
| Sistema → Google | Worker con service account | `POST /api/gcal` ([worker/gcal.ts](../worker/gcal.ts)) |

`worker/gcal.ts` firma un JWT RS256 con la clave privada de la service account,
lo cambia por un access token en `oauth2.googleapis.com/token` (cacheado ~55 min)
y pega a la API de Calendar. Acciones: `create | patch | delete | list | status`.

El cliente ([src/lib/googleCalendar.ts](../src/lib/googleCalendar.ts)) ya no tiene
OAuth ni tokens: solo hace `fetch('/api/gcal')`. Las firmas de
`createCalendarEvent` / `updateCalendarEvent` / `deleteCalendarEvent` /
`listCalendarEvents` no cambiaron, así que los call sites quedaron iguales.

En `vite dev` el Worker no corre, así que [vite.config.ts](../vite.config.ts)
monta la misma ruta con el **mismo módulo**, leyendo el `.env` local.

## Configuración

Ya hecho en Google Cloud (proyecto `MEDUSA` / `medusa-509601`): service account
`gcal-sync@medusa-509601.iam.gserviceaccount.com`, sin roles de IAM (el acceso se
da compartiendo cada calendario), y Google Calendar API habilitada.

### 1. Secrets del Worker (producción)

Desde el JSON de la clave, sin que la clave pase por el historial del shell:

```bash
jq -r .client_email clave.json | npx wrangler secret put GCAL_SA_EMAIL
jq -r .private_key  clave.json | npx wrangler secret put GCAL_SA_PRIVATE_KEY
```

### 2. Compartir cada calendario de sucursal

En Google Calendar → el calendario del salón → *Compartir con personas
específicas* → agregar `gcal-sync@medusa-509601.iam.gserviceaccount.com` con
permiso **"Hacer cambios en los eventos"**.

Sin este paso Google responde `Not Found` a todo: la service account no ve un
calendario que no le compartieron.

### 3. ID del calendario en la sucursal

`branch.google_calendar_id` es obligatorio. Una service account **no tiene
calendario `primary`**, así que si el campo está vacío no hay destino posible: el
servidor devuelve un error explícito y la cita se guarda igual, solo sin evento
en Google.

## Verificar

En la vista de calendario → menú → **Probar conexión con Google**. Dice si el
servidor tiene la service account y si llega al calendario de la sucursal, con el
motivo concreto cuando falla (faltan secrets, falta compartir, falta el ID).

## Notas

- Los eventos se crean con `sendUpdates=none` y sin `attendees`: son la agenda
  interna del salón, no invitaciones.
- El scope es solo `calendar.events`. Por eso el diagnóstico prueba listando un
  evento y no leyendo `/calendars/{id}`, que pediría un scope más amplio.
- La clave JSON **nunca** va al repo (ver `.gitignore`). Si se filtra, se borra
  esa clave en Google Cloud y se genera otra.
- Ya no se usan `VITE_GOOGLE_CLIENT_ID` ni `VITE_GOOGLE_SECRET`; el client OAuth
  del proyecto se puede borrar.
