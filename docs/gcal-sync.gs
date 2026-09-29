/**
 * Medusa Estudio — Sincronización Google Calendar → Sistema
 * ==========================================================
 * Se ejecuta como el DUEÑO del calendario. Un trigger instalable dispara cuando
 * el calendario cambia; el script pide solo lo que cambió (syncToken) y lo envía
 * al Worker de Cloudflare, autenticado con service token de Access + secreto.
 *
 * Propiedades del script requeridas:
 *   WORKER_URL, CALENDAR_ID, GCAL_SECRET, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET
 * Servicio avanzado: Google Calendar API (id Calendar).
 * Ejecutar setUp() una vez.
 *
 * Correcciones respecto de la versión original:
 *   - followRedirects:false → un bloqueo de Access (302 al login) ya no se toma como éxito.
 *   - El SYNC_TOKEN se guarda solo después de un POST exitoso (no se pierden cambios).
 *   - El reintento por 410 (syncToken caducado) realmente rehace el sync completo.
 *   - LockService evita ejecuciones solapadas.
 *
 * Colores (necesario para saber de quién es cada cita):
 *   - Se manda el HEX real del color, no solo el colorId. Google expone dos
 *     paletas: `event` (los 11 clásicos) y `calendar` (las 24 del selector
 *     nuevo: Calabaza, Mango, Eucalipto…). Con el colorId solo, los colores de
 *     la paleta ampliada no se podían mapear a ninguna colaboradora.
 *   - Un evento sin color propio hereda el color del calendario.
 *   - resyncAll() reenvía todo: el sync normal es incremental, así que las
 *     citas ya sincronizadas se quedarían sin color.
 */

var TZ = 'America/Guayaquil';

/** Días hacia atrás que abarca un sync completo (ver resyncAll). */
var FULL_SYNC_DAYS = 60;

/**
 * colorId que se manda cuando el evento no tiene color propio y hereda el del
 * calendario. Así la tabla gcal_color_map puede decidir de quién son esas
 * citas, en vez de que el Worker lo adivine por el hex.
 */
var DEFAULT_COLOR_ID = 'default';

function cfg_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Falta la propiedad del script: ' + key);
  return v;
}

/** Ejecutar UNA vez: crea el trigger por edición del calendario + sync inicial. */
function setUp() {
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
  // Respaldo: el trigger de Calendar a veces no dispara o se demora. Cada 5 min
  // pide solo los cambios (syncToken), así que es barato si no hay novedades.
  ScriptApp.newTrigger('syncCalendar').timeBased().everyMinutes(5).create();

  resyncAll();
  PropertiesService.getScriptProperties().deleteProperty('TEST_EVENT_ID');
  Logger.log('Configuración lista. Triggers creados y sync inicial ejecutado.');
}

/**
 * Reenvía TODO de nuevo (últimos FULL_SYNC_DAYS días en adelante).
 *
 * Correr a mano después de cambiar este script o el Worker: el sync normal es
 * incremental (syncToken) y solo manda los eventos que cambiaron, así que las
 * citas ya sincronizadas se quedarían sin los datos nuevos —por ejemplo el
 * color—. Es idempotente: los upserts del Worker se pueden repetir sin riesgo.
 */
function resyncAll() {
  PropertiesService.getScriptProperties().deleteProperty('SYNC_TOKEN');
  syncCalendar();
  Logger.log('Re-sincronización completa terminada.');
}

/**
 * Diagnóstico: imprime las dos paletas de Google con su id y su hex. Sirve para
 * alinear la tabla gcal_color_map con los colores reales del equipo.
 */
function logColors() {
  var c = Calendar.Colors.get();
  ['event', 'calendar'].forEach(function (kind) {
    var map = c[kind] || {};
    Logger.log('--- paleta ' + kind + ' ---');
    Object.keys(map).forEach(function (id) {
      Logger.log(kind + ' ' + id + ' -> ' + map[id].background + ' (ui ' + toUiHex_(map[id].background) + ')');
    });
  });
  Logger.log('color por defecto en uso: ' + defaultColorHex_());
}

/**
 * Diagnóstico fino: qué calendario está leyendo, con qué color por defecto y
 * qué colorId trae cada evento reciente. Sirve para confirmar de dónde sale un
 * color que no cuadra con lo que se ve en la UI.
 */
function debugColors() {
  var id = cfg_('CALENDAR_ID');
  var entry = Calendar.CalendarList.get(id);
  Logger.log('calendario: ' + entry.id +
    ' | summary=' + entry.summary +
    ' | colorId=' + entry.colorId +
    ' | backgroundColor=' + entry.backgroundColor +
    ' (ui ' + toUiHex_(entry.backgroundColor) + ')');
  Logger.log('DEFAULT_COLOR_HEX = ' +
    (PropertiesService.getScriptProperties().getProperty('DEFAULT_COLOR_HEX') || '(sin definir)'));
  Logger.log('color por defecto en uso: ' + defaultColorHex_());

  // Quién corre el script: si no es quien pinta los eventos, un color puesto
  // desde otra cuenta puede vivir en la copia de esa cuenta y no en la nuestra.
  Logger.log('script corre como: ' + Session.getEffectiveUser().getEmail());
  Logger.log('accessRole sobre el calendario: ' + entry.accessRole);

  var from = new Date();
  from.setDate(from.getDate() - 2);
  var r = Calendar.Events.list(id, {
    singleEvents: true, maxResults: 30, orderBy: 'startTime', timeMin: from.toISOString(),
  });
  (r.items || []).forEach(function (ev) {
    Logger.log('- ' + (ev.summary || '(sin titulo)') +
      ' | colorId=' + (ev.colorId || 'NINGUNO') +
      ' | hex=' + eventColorHex_(ev.colorId || null) +
      ' | creator=' + ((ev.creator && ev.creator.email) || '?') +
      ' | organizer=' + ((ev.organizer && ev.organizer.email) || '?') +
      ' | recurrente=' + (ev.recurringEventId ? 'si' : 'no') +
      ' | eventType=' + (ev.eventType || '-'));
  });
}

/* ──────────────────── Repintado de eventos sin color ──────────────────── */

/** colorId de Mandarina: el naranja que sí existe en la paleta de la API. */
var MANDARINA_ID = '6';

/** Junta los eventos vivos que la API reporta sin color, desde hoy hacia atrás. */
function sinColor_() {
  var id = cfg_('CALENDAR_ID');
  var from = new Date();
  from.setDate(from.getDate() - FULL_SYNC_DAYS);
  var out = [];
  var pageToken = null;
  do {
    var params = {
      singleEvents: true, maxResults: 250,
      orderBy: 'startTime', timeMin: from.toISOString(),
    };
    if (pageToken) params.pageToken = pageToken;
    var r = Calendar.Events.list(id, params);
    (r.items || []).forEach(function (ev) {
      if (ev.status === 'cancelled') return;
      if (ev.colorId) return;
      out.push(ev);
    });
    pageToken = r.nextPageToken || null;
  } while (pageToken);
  return out;
}

/**
 * SOLO LISTA, no toca nada. Corré esto primero y revisá el listado contra el
 * calendario: son los eventos que la API ve sin color. Ahí están mezclados los
 * de Zanahoria (Lesly) y los que usan "Predeterminada", porque Google los
 * reporta igual. Si en el listado aparece alguno que NO es de Lesly, no corras
 * el repintado: los pasaría todos a ella.
 */
function listarSinColor() {
  var evs = sinColor_();
  Logger.log('Eventos que la API ve sin color: ' + evs.length);
  evs.forEach(function (ev) {
    var cuando = (ev.start && (ev.start.dateTime || ev.start.date)) || '?';
    Logger.log('- ' + cuando + '  ' + (ev.summary || '(sin titulo)'));
  });
}

/**
 * Repinta a Mandarina TODOS los eventos que la API ve sin color.
 *
 * Irreversible en bloque: Google no guarda historial de color. Corré
 * listarSinColor() antes y asegurate de que todos sean de Lesly.
 */
function repintarSinColorAMandarina() {
  var id = cfg_('CALENDAR_ID');
  var evs = sinColor_();
  Logger.log('A repintar: ' + evs.length + ' evento(s).');
  var hechos = 0;
  var fallos = 0;
  evs.forEach(function (ev) {
    try {
      Calendar.Events.patch({ colorId: MANDARINA_ID }, id, ev.id);
      hechos++;
    } catch (err) {
      fallos++;
      Logger.log('fallo ' + (ev.summary || ev.id) + ': ' + err);
    }
  });
  Logger.log('Repintados ' + hechos + ', con error ' + fallos + '.');
  Logger.log('Corre resyncAll() para que el sistema tome los colores nuevos.');
}

/** Handler del trigger (y del sync inicial). Pull incremental por syncToken. */
function syncCalendar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Otra ejecución en curso; se omite.');
    return;
  }
  try {
    var props = PropertiesService.getScriptProperties();
    var calendarId = cfg_('CALENDAR_ID');
    var syncToken = props.getProperty('SYNC_TOKEN');
    var events = [];
    var pageToken = null;
    var nextSyncToken = null;
    var retry = false;

    do {
      retry = false;
      var params = { singleEvents: true, showDeleted: true, maxResults: 250 };
      if (syncToken) {
        params.syncToken = syncToken;
      } else {
        var from = new Date();
        from.setDate(from.getDate() - FULL_SYNC_DAYS);
        params.timeMin = from.toISOString();
      }
      if (pageToken) params.pageToken = pageToken;

      var resp;
      try {
        resp = Calendar.Events.list(calendarId, params);
      } catch (err) {
        var msg = String(err);
        if (syncToken && (msg.indexOf('410') !== -1 || msg.indexOf('Sync token') !== -1)) {
          props.deleteProperty('SYNC_TOKEN');
          syncToken = null;
          pageToken = null;
          events = [];
          retry = true;
          continue;
        }
        throw err;
      }

      (resp.items || []).forEach(function (ev) {
        events.push(normalizeEvent_(ev));
      });
      pageToken = resp.nextPageToken || null;
      if (resp.nextSyncToken) nextSyncToken = resp.nextSyncToken;
    } while (pageToken || retry);

    if (events.length > 0) {
      // En lotes chicos: cada evento usa varias subrequests a Turso y el Worker
      // tiene límite por invocación. Los upserts son idempotentes, así que
      // reintentar un lote es seguro.
      var CHUNK = 5;
      for (var c = 0; c < events.length; c += CHUNK) {
        postToWorker_({ calendarId: calendarId, events: events.slice(c, c + CHUNK) }); // lanza si falla
      }
      Logger.log('Enviados ' + events.length + ' evento(s) al sistema en ' + Math.ceil(events.length / CHUNK) + ' lote(s).');
    } else {
      Logger.log('Sin cambios.');
    }
    // Solo se avanza el token cuando el Worker confirmó.
    if (nextSyncToken) props.setProperty('SYNC_TOKEN', nextSyncToken);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Paletas de Google, cacheadas por ejecución. `event` son los 11 colores de
 * evento clásicos; `calendar` son los 24 del selector nuevo. Miramos las dos,
 * porque un evento puede venir pintado con un color de la paleta ampliada.
 */
var COLORS_CACHE_ = null;
function colors_() {
  if (!COLORS_CACHE_) {
    var c = Calendar.Colors.get();
    COLORS_CACHE_ = { event: c.event || {}, calendar: c.calendar || {} };
  }
  return COLORS_CACHE_;
}

/**
 * Color que se les pone a los eventos sin color propio.
 *
 * NO se saca de CalendarList.backgroundColor: ese campo es *por cuenta* —cada
 * usuario le pone al mismo calendario el color que quiere en su lista—, así que
 * la cuenta que corre el script puede reportar un color que nadie ve. Pasó:
 * devolvía uva (#cd74e6) mientras en la UI los eventos se ven Calabaza.
 *
 * Fuente de verdad: la propiedad de script DEFAULT_COLOR_HEX (ej. '#EF6C00').
 * Sin ella se cae al color de la lista, solo como último recurso.
 */
var CAL_COLOR_CACHE_ = null;
function defaultColorHex_() {
  if (CAL_COLOR_CACHE_ === null) {
    var fixed = PropertiesService.getScriptProperties().getProperty('DEFAULT_COLOR_HEX');
    if (fixed && fixed.trim()) {
      CAL_COLOR_CACHE_ = fixed.trim();
    } else {
      try {
        CAL_COLOR_CACHE_ = toUiHex_(Calendar.CalendarList.get(cfg_('CALENDAR_ID')).backgroundColor) || '';
      } catch (err) {
        CAL_COLOR_CACHE_ = '';
      }
    }
  }
  return CAL_COLOR_CACHE_;
}

/**
 * Traducción paleta vieja → paleta que Google dibuja hoy.
 *
 * La API devuelve los hex históricos (colorId 10 = '#51b749'), pero Google
 * Calendar pinta ese mismo evento con '#0B8043' (Albahaca). Si mandáramos el
 * hex crudo, la agenda del sistema saldría de otro tono que la de Google y el
 * color nunca coincidiría con el identificador de ninguna colaboradora.
 *
 * Va por hex y no por colorId a propósito: así no depende del orden de las
 * paletas. Un hex que no esté en la tabla pasa tal cual.
 */
var LEGACY_TO_UI_ = {
  // paleta de evento (11)
  '#a4bdfc': '#7986CB', // Lavanda
  '#7ae7bf': '#33B679', // Menta
  '#dbadff': '#8E24AA', // Uva
  '#ff887c': '#E67C73', // Flamenco
  '#fbd75b': '#F6BF26', // Girasol
  '#ffb878': '#F4511E', // Mandarina
  '#46d6db': '#039BE5', // Turquesa
  '#e1e1e1': '#616161', // Grafito
  '#5484ed': '#3F51B5', // Índigo
  '#51b749': '#0B8043', // Albahaca
  '#dc2127': '#D50000', // Tomate
  // paleta de calendario (24)
  '#ac725e': '#795548', // Chocolate
  '#d06b64': '#E67C73', // Flamenco
  '#f83a22': '#D50000', // Tomate
  '#fa573c': '#F4511E', // Mandarina
  '#ff7537': '#EF6C00', // Calabaza
  '#ffad46': '#F09300', // Mango
  '#42d692': '#009688', // Eucalipto
  '#16a765': '#0B8043', // Albahaca
  '#7bd148': '#7CB342', // Pistacho
  '#b3dc6c': '#C0CA33', // Aguacate
  '#fbe983': '#E4C441', // Mostaza
  '#fad165': '#F6BF26', // Girasol
  '#92e1c0': '#33B679', // Menta
  '#9fe1e7': '#039BE5', // Turquesa
  '#9fc6e7': '#4285F4', // Cobalto
  '#4986e7': '#3F51B5', // Índigo
  '#9a9cff': '#7986CB', // Lavanda
  '#b99aff': '#B39DDB', // Malva
  '#c2c2c2': '#616161', // Grafito
  '#cabdbf': '#A79B8E', // Abedul
  '#cca6ac': '#AD1457', // Vino
  '#f691b2': '#D81B60', // Rosa
  '#cd74e6': '#8E24AA', // Uva
  '#a47ae2': '#9E69AF', // Amatista
};

function toUiHex_(hex) {
  if (!hex) return null;
  return LEGACY_TO_UI_[String(hex).toLowerCase()] || hex;
}

/**
 * Hex del color con que se ve el evento. Sin color propio → el del calendario.
 * Si el colorId no está en ninguna paleta devolvemos null en vez de inventar:
 * el Worker prefiere no asignar antes que asignar mal.
 */
function eventColorHex_(colorId) {
  if (!colorId) return defaultColorHex_() || null;
  var maps = colors_();
  var entry = maps.event[colorId] || maps.calendar[colorId];
  return entry && entry.background ? toUiHex_(entry.background) : null;
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
  var colorId = ev.colorId || null;
  return {
    id: ev.id,
    status: ev.status,
    summary: ev.summary || '',
    startLocal: startLocal,
    endLocal: endLocal,
    // Sin color propio va el sentinel, para que gcal_color_map pueda mapearlo.
    colorId: colorId || DEFAULT_COLOR_ID,
    // Hex real del color: es lo que usa el Worker para saber de qué
    // colaboradora es la cita cuando el colorId no está en gcal_color_map.
    colorHex: eventColorHex_(colorId),
  };
}

/** POST autenticado al Worker (secreto compartido + service token de Access). */
function postToWorker_(payload) {
  var resp = UrlFetchApp.fetch(cfg_('WORKER_URL'), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: false,
    headers: {
      'x-gcal-secret': cfg_('GCAL_SECRET'),
      'CF-Access-Client-Id': cfg_('CF_ACCESS_CLIENT_ID'),
      'CF-Access-Client-Secret': cfg_('CF_ACCESS_CLIENT_SECRET'),
    },
  });
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    var loc = resp.getHeaders()['Location'] || '';
    throw new Error('Worker respondió ' + code + (loc ? ' -> ' + loc : '') + ': ' +
      resp.getContentText().slice(0, 500));
  }
  Logger.log('Worker OK: ' + resp.getContentText());
}
