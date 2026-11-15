const env = require('../config/env');
const refreshRequestsRepository = require('../repositories/refreshRequestsRepository');
const refreshRunsRepository = require('../repositories/refreshRunsRepository');
const workerStateRepository = require('../repositories/workerStateRepository');
const categoriesRepository = require('../repositories/categoriesRepository');
const batch = require('./batchRefreshService');
const worker = require('../jobs/refreshWorker');

// Lo que se está refrescando ahora. Si lo hace este mismo proceso se sabe en
// memoria (al producto); si lo hace el worker remoto, se lee de la base.
async function enCurso() {
  const local = batch.estadoActual();
  if (local) return local;
  const run = await refreshRunsRepository.findEnCurso();
  if (!run) return null;
  return {
    tipo: run.tipo, detalle: run.detalle, solicitudId: null,
    total: run.total, hechos: run.ok + run.fail, ok: run.ok, fail: run.fail,
  };
}

// "Actualizar precios" deja la solicitud en la base y despierta al worker
// (src/jobs/refreshWorker.js), que la procesa en segundo plano. La web
// consulta el estado hasta que termina.
async function solicitar(categoria) {
  const categoryId = await categoriesRepository.findOrCreateIdByName(categoria);
  const id = await refreshRequestsRepository.create(categoryId);
  worker.despertar();
  return id;
}

async function estado(id) {
  const s = await refreshRequestsRepository.getStatus(id);
  if (s === null) {
    const err = new Error('No existe');
    err.status = 404;
    throw err;
  }
  const actual = s.terminada ? null : await enCurso();
  // Tomada y sin terminar: lo que esté corriendo de tipo categoría es esta.
  const esEsta = actual && s.tomada && actual.tipo === 'categoria';
  return {
    procesado: s.terminada,
    enCola: !s.tomada,
    ok: s.ok, fail: s.fail,
    avance: esEsta ? { hechos: actual.hechos, total: actual.total } : null,
    // Si está en cola detrás de otra corrida, se informa cuál.
    esperandoA: !s.tomada && actual ? { tipo: actual.tipo, detalle: actual.detalle, hechos: actual.hechos, total: actual.total } : null,
  };
}

async function solicitarTotal() {
  await worker.pedirTotal();
}

// Resumen para la portada: quién está refrescando, cuándo fue el último,
// cómo le fue y cuándo es el próximo.
async function resumen() {
  const [ultimo, ultimoCompleto, actual, totalEnCola, remoto] = await Promise.all([
    refreshRunsRepository.findLast(),
    refreshRunsRepository.findLastFull(),
    enCurso(),
    workerStateRepository.totalPendiente(),
    workerStateRepository.remoto(),
  ]);
  const auto = worker.estaActivo() || remoto.activo;
  return {
    auto,
    horas: env.refreshHours,
    proxy: !!env.proxyUrl,
    // Worker remoto (teléfono / PC): si está vivo, es él quien refresca.
    remoto,
    enCurso: actual,
    totalEnCola,
    ultimo,
    ultimoCompleto,
    proximo: auto ? worker.proximoRefresh() : null,
  };
}

module.exports = { solicitar, estado, solicitarTotal, resumen };
