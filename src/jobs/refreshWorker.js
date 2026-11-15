// Worker de refresh. Reemplaza a los dos .bat que antes corría la PC con el
// Programador de tareas de Windows:
//
//   - refresh-diario.bat  → refresh completo en las horas de REFRESH_HOURS
//   - watch-refresh.bat   → atender el botón "Actualizar precios" de la web
//
// Corre en dos lugares posibles, coordinados a través de la base de datos:
//
//   - 'servidor': dentro del proceso web (server.js). Scrapea con curl y, si
//     Cloudflare bloquea, con un browser real.
//   - 'remoto':   scripts/worker-telefono.js en un teléfono (Termux) o una PC
//     con IP residencial. Scrapea solo con curl.
//
// Mientras haya un worker remoto dando señales de vida, el servidor le cede
// todo el trabajo. Si el remoto desaparece, el servidor vuelve a intentarlo solo.
//
// Dentro de cada proceso todo el scraping pasa por una sola cola (de a un
// producto a la vez), así el refresh diario y los pedidos de la web no se pisan.

const env = require('../config/env');
const batch = require('../services/batchRefreshService');
const refreshRequestsRepository = require('../repositories/refreshRequestsRepository');
const refreshRunsRepository = require('../repositories/refreshRunsRepository');
const workerStateRepository = require('../repositories/workerStateRepository');

const origen = env.workerOrigen;
const esRemoto = origen === 'remoto';
const INTERVALO_MS = esRemoto ? 15 * 1000 : 30 * 1000;
const LATIDO_MS = 45 * 1000;

let log = msg => console.log(msg);
let fetchFn; // undefined = el default de productService (curl + browser)
let activo = false;
let ocupado = false;
let timer = null;
let timerLatido = null;

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
// configuradas de hoy y todavía no se corrió nada que cuente desde esa hora.
// Cubre también el caso de que este proceso estuviera apagado a la hora
// exacta. Un intento propio que terminó bloqueado no se repite hasta la hora
// siguiente (ver findLastFullQueCuenta).
async function diarioPendiente() {
  if (!env.refreshHours.length) return null;
  const hoy = enZona(new Date());
  const turno = [...env.refreshHours].reverse().find(h => h <= hoy.hora);
  if (turno === undefined) return null;

  const ultimo = await refreshRunsRepository.findLastFullQueCuenta(origen);
  const cuando = ultimo ? enZona(new Date(ultimo.iniciadoEn)) : null;
  if (cuando && cuando.dia === hoy.dia && cuando.hora >= turno) return null;
  // Los cambios de precio de ayer se limpian solo en la primera corrida del día.
  // En la primerísima corrida (recién desplegado, sin historial) no se limpia
  // nada: la lista puede tener cambios de hoy detectados por el sistema anterior.
  return { limpiar: !!cuando && cuando.dia !== hoy.dia };
}

function proximoRefresh() {
  if (!env.refreshHours.length) return null;
  const { hora } = enZona(new Date());
  const hoy = env.refreshHours.find(h => h > hora);
  return hoy !== undefined ? { hora: hoy, dia: 'hoy' } : { hora: env.refreshHours[0], dia: 'mañana' };
}

async function tick() {
  if (!activo || ocupado) return;
  ocupado = true;
  try {
    // El servidor se hace a un lado mientras el worker remoto esté vivo.
    if (!esRemoto && (await workerStateRepository.remoto()).activo) return;

    await batch.procesarSolicitudesPendientes({ fetchFn, log });

    if (await workerStateRepository.tomarTotal()) {
      await batch.refreshTotal({ tipo: 'manual', fetchFn, log });
    } else {
      const diario = await diarioPendiente();
      if (diario) await batch.refreshTotal({ tipo: 'diario', limpiar: diario.limpiar, fetchFn, log });
    }

    // Lo que haya entrado mientras corría el refresh completo.
    await batch.procesarSolicitudesPendientes({ fetchFn, log });
  } catch (e) {
    console.error(`Worker de refresh: ${e.message}`);
  } finally {
    ocupado = false;
  }
}

// Adelanta la próxima pasada (alguien apretó un botón en la web).
function despertar() {
  if (activo) setImmediate(tick);
}

// "Actualizar todo ahora". Queda anotado en la base y lo toma el worker que
// esté a cargo: el remoto si está vivo, si no este servidor.
async function pedirTotal() {
  const remoto = await workerStateRepository.remoto();
  if (!activo && !remoto.activo) {
    const err = new Error('El refresh automático está desactivado en este servidor (AUTO_REFRESH=0)');
    err.status = 409;
    throw err;
  }
  const enCurso = await refreshRunsRepository.findEnCurso();
  const nuevo = !(enCurso && enCurso.tipo !== 'categoria') && await workerStateRepository.pedirTotal();
  if (!nuevo) {
    const err = new Error('Ya hay una actualización completa en curso');
    err.status = 409;
    throw err;
  }
  despertar();
}

// opciones.fetchFn: cómo traer el HTML (ver productService.refreshSku).
async function iniciar(opciones = {}) {
  if (!esRemoto && !env.autoRefresh) {
    console.log('Refresh automático desactivado (AUTO_REFRESH=0).');
    return;
  }
  fetchFn = opciones.fetchFn;
  if (opciones.log) log = opciones.log;

  // Lo que quedó a medias de un proceso anterior (redeploy / reinicio).
  await refreshRunsRepository.closeOrphans(origen).catch(() => {});
  await refreshRequestsRepository.closeOrphans().catch(() => {});

  activo = true;
  if (esRemoto) {
    // El latido va en su propio timer: tiene que seguir saliendo durante un
    // refresh largo, cuando tick() está ocupado.
    const latir = () => workerStateRepository.latido(opciones.detalle).catch(e => console.error(`Sin conexión a la base: ${e.message}`));
    await latir();
    timerLatido = setInterval(latir, LATIDO_MS);
  }
  timer = setInterval(tick, INTERVALO_MS);
  // Primera pasada apenas termina de levantar.
  setTimeout(tick, esRemoto ? 1000 : 5000);
  console.log(`Refresh automático activo (${origen}) — refresh completo a las ${env.refreshHours.map(h => `${h}:00`).join(', ') || '(sin horario)'} (${env.refreshTimezone}).`);
}

function detener() {
  activo = false;
  clearInterval(timer);
  clearInterval(timerLatido);
}

module.exports = {
  iniciar, detener, despertar, pedirTotal, proximoRefresh,
  estaActivo: () => activo,
};
