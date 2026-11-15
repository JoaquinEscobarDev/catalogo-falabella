// Worker de refresh que vive dentro del servidor. Reemplaza a los dos .bat
// que antes corría la PC con el Programador de tareas de Windows:
//
//   - refresh-diario.bat  → refresh completo en las horas de REFRESH_HOURS
//   - watch-refresh.bat   → atender el botón "Actualizar precios" de la web
//
// Todo el scraping pasa por una sola cola (de a un producto a la vez), así el
// refresh diario y los pedidos de la web nunca se pisan.

const env = require('../config/env');
const batch = require('../services/batchRefreshService');
const refreshRequestsRepository = require('../repositories/refreshRequestsRepository');
const refreshRunsRepository = require('../repositories/refreshRunsRepository');

const INTERVALO_MS = 30 * 1000;
const log = msg => console.log(msg);

let activo = false;
let ocupado = false;
let totalPedido = false;
let timer = null;

// Fecha (AAAA-MM-DD) y hora (0-23) en la zona horaria del negocio.
function enZona(fecha) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.refreshTimezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(fecha);
  const p = Object.fromEntries(partes.map(x => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: parseInt(p.hour, 10) };
}

// ¿Toca el refresh programado? Sí, si ya pasó alguna de las horas
// configuradas de hoy y todavía no se corrió nada desde esa hora. Cubre
// también el caso de que el servidor estuviera apagado a la hora exacta.
// Un refresh que terminó bloqueado no se reintenta hasta la hora siguiente.
async function diarioPendiente() {
  if (!env.refreshHours.length) return null;
  const hoy = enZona(new Date());
  const turno = [...env.refreshHours].reverse().find(h => h <= hoy.hora);
  if (turno === undefined) return null;

  const ultimo = await refreshRunsRepository.findLastFull();
  const cuando = ultimo ? enZona(new Date(ultimo.iniciadoEn)) : null;
  if (cuando && cuando.dia === hoy.dia && cuando.hora >= turno) return null;
  // Los cambios de precio de ayer se limpian solo en la primera corrida del día.
  // En la primerísima corrida (recién desplegado, sin historial) no se limpia
  // nada: la lista puede tener cambios de hoy detectados por el sistema anterior.
  return { limpiar: !!cuando && cuando.dia !== hoy.dia };
}

function proximoRefresh() {
  if (!activo || !env.refreshHours.length) return null;
  const { hora } = enZona(new Date());
  const hoy = env.refreshHours.find(h => h > hora);
  return hoy !== undefined ? { hora: hoy, dia: 'hoy' } : { hora: env.refreshHours[0], dia: 'mañana' };
}

async function tick() {
  if (!activo || ocupado) return;
  ocupado = true;
  try {
    await batch.procesarSolicitudesPendientes({ log });

    if (totalPedido) {
      totalPedido = false;
      await batch.refreshTotal({ tipo: 'manual', log });
    } else {
      const diario = await diarioPendiente();
      if (diario) await batch.refreshTotal({ tipo: 'diario', limpiar: diario.limpiar, log });
    }

    // Lo que haya entrado mientras corría el refresh completo.
    await batch.procesarSolicitudesPendientes({ log });
  } catch (e) {
    console.error('Worker de refresh:', e.message);
  } finally {
    ocupado = false;
  }
}

// Adelanta la próxima pasada (alguien apretó un botón en la web).
function despertar() {
  if (activo) setImmediate(tick);
}

function pedirTotal() {
  if (!activo) {
    const err = new Error('El refresh automático está desactivado en este servidor (AUTO_REFRESH=0)');
    err.status = 409;
    throw err;
  }
  const actual = batch.estadoActual();
  if (totalPedido || (actual && actual.tipo !== 'categoria')) {
    const err = new Error('Ya hay una actualización completa en curso');
    err.status = 409;
    throw err;
  }
  totalPedido = true;
  despertar();
}

async function iniciar() {
  if (!env.autoRefresh) {
    console.log('Refresh automático desactivado (AUTO_REFRESH=0).');
    return;
  }
  // Lo que quedó a medias de un proceso anterior (redeploy / reinicio).
  await refreshRunsRepository.closeOrphans().catch(() => {});
  await refreshRequestsRepository.closeOrphans().catch(() => {});

  activo = true;
  timer = setInterval(tick, INTERVALO_MS);
  // Primera pasada apenas el servidor termina de levantar.
  setTimeout(tick, 5000).unref?.();
  console.log(`Refresh automático activo — refresh completo a las ${env.refreshHours.map(h => `${h}:00`).join(', ') || '(sin horario)'} (${env.refreshTimezone}).`);
}

function detener() {
  activo = false;
  clearInterval(timer);
}

module.exports = {
  iniciar, detener, despertar, pedirTotal, proximoRefresh,
  estaActivo: () => activo,
  totalEnCola: () => totalPedido,
};
