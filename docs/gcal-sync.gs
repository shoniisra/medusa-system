/**
 * Medusa Estudio — Sincronización Google Calendar → Sistema
 * ==========================================================
 *
 * Se ejecuta como el DUEÑO del calendario (cuenta Gmail), así que NO hace falta
 * compartir el calendario con nadie. Un trigger instalable dispara cuando el
 * calendario cambia; el script pide a Google solo lo que cambió (syncToken,
 * incluye el color del evento) y lo envía al Worker de Cloudflare, que hace el
 * upsert en la base.
 *
 * REQUISITOS (ver el prompt de configuración del navegador):
 *   1. Servicios → agregar "Google Calendar API" (servicio avanzado, id Calendar).
 *   2. Propiedades del script (Configuración → Propiedades del script):
 *        WORKER_URL             = https://admin.medusa-estudio.com/api/gcal-sync
 *        CALENDAR_ID            = 7de4355...@group.calendar.google.com
 *        GCAL_SECRET            = <mismo secreto que GCAL_SYNC_SECRET del Worker>
 *        CF_ACCESS_CLIENT_ID    = <Client ID del service token de Cloudflare Access>
 *        CF_ACCESS_CLIENT_SECRET= <Client Secret del service token>
 *   3. Ejecutar setUp() una vez (autoriza permisos y crea el trigger).
 *
 * Zona horaria del salón: se formatea todo a America/Guayaquil (hora de pared).
 */

var TZ = 'America/Guayaquil';

function cfg_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Falta la propiedad del script: ' + key);
  return v;
}

/** Ejecutar UNA vez: crea el trigger por edición del calendario + sync inicial. */
function setUp() {
  // Evita triggers duplicados si se corre más de una vez.
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncCalendar') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('syncCalendar')
    .forUserCalendar(cfg_('CALENDAR_ID'))
    .onEventUpdated()
    .create();

  // Fuerza una primera pasada completa.
  PropertiesService.getScriptProperties().deleteProperty('SYNC_TOKEN');
  syncCalendar();
  Logger.log('Configuración lista. Trigger creado y sync inicial ejecutado.');
}

/** Handler del trigger (y del sync inicial). Pull incremental por syncToken. */
function syncCalendar() {
  var props = PropertiesService.getScriptProperties();
  var calendarId = cfg_('CALENDAR_ID');
  var syncToken = props.getProperty('SYNC_TOKEN');

  var events = [];
  var pageToken = null;

  do {
    var params = { singleEvents: true, showDeleted: true, maxResults: 250 };
    if (syncToken) {
      params.syncToken = syncToken;
    } else {
      // Primera vez: desde hace 7 días hacia adelante.
      var from = new Date();
      from.setDate(from.getDate() - 7);
      params.timeMin = from.toISOString();
    }
    if (pageToken) params.pageToken = pageToken;

    var resp;
    try {
      resp = Calendar.Events.list(calendarId, params);
    } catch (err) {
      // 410 GONE → el syncToken caducó: reseteamos y hacemos full sync.
      if (String(err).indexOf('Sync token') !== -1 || String(err).indexOf('410') !== -1) {
        props.deleteProperty('SYNC_TOKEN');
        syncToken = null;
        pageToken = null;
        events = [];
        continue;
      }
      throw err;
    }

    (resp.items || []).forEach(function (ev) {
      events.push(normalizeEvent_(ev));
    });

    pageToken = resp.nextPageToken || null;
    if (resp.nextSyncToken) props.setProperty('SYNC_TOKEN', resp.nextSyncToken);
  } while (pageToken);

  if (events.length === 0) {
    Logger.log('Sin cambios.');
    return;
  }

  postToWorker_({ calendarId: calendarId, events: events });
  Logger.log('Enviados ' + events.length + ' evento(s) al sistema.');
}

/** Convierte un evento de Google al shape que espera el Worker. */
function normalizeEvent_(ev) {
  var startLocal = null;
  var endLocal = null;
  if (ev.start && ev.start.dateTime) {
    startLocal = Utilities.formatDate(new Date(ev.start.dateTime), TZ, "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (ev.end && ev.end.dateTime) {
    endLocal = Utilities.formatDate(new Date(ev.end.dateTime), TZ, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return {
    id: ev.id,
    status: ev.status, // 'confirmed' | 'cancelled' | 'tentative'
    summary: ev.summary || '',
    startLocal: startLocal, // null = evento de todo el día (se ignora)
    endLocal: endLocal,
    colorId: ev.colorId || null, // '1'..'11' o null (color por defecto)
  };
}

/** POST autenticado al Worker (secreto compartido + service token de Access). */
function postToWorker_(payload) {
  var resp = UrlFetchApp.fetch(cfg_('WORKER_URL'), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    headers: {
      'x-gcal-secret': cfg_('GCAL_SECRET'),
      'CF-Access-Client-Id': cfg_('CF_ACCESS_CLIENT_ID'),
      'CF-Access-Client-Secret': cfg_('CF_ACCESS_CLIENT_SECRET'),
    },
  });
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Worker respondió ' + code + ': ' + resp.getContentText());
  }
  Logger.log('Worker OK: ' + resp.getContentText());
}
