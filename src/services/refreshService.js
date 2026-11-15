const env = require('../config/env');
const refreshRequestsRepository = require('../repositories/refreshRequestsRepository');
const refreshRunsRepository = require('../repositories/refreshRunsRepository');
const categoriesRepository = require('../repositories/categoriesRepository');
const batch = require('./batchRefreshService');
const worker = require('../jobs/refreshWorker');

// "Actualizar precios" deja la solicitud en la base y despierta al worker del
// servidor (src/jobs/refreshWorker.js), que la procesa en segundo plano. La
// web consulta el estado hasta que termina.
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
  const actual = batch.estadoActual();
  const esEsta = actual && String(actual.solicitudId) === String(id);
  return {
    procesado: s.terminada,
    enCola: !s.tomada,
    ok: s.ok, fail: s.fail,
    avance: esEsta ? { hechos: actual.hechos, total: actual.total } : null,
    // Si está en cola detrás de otra corrida, se informa cuál.
    esperandoA: !s.tomada && actual ? { tipo: actual.tipo, detalle: actual.detalle, hechos: actual.hechos, total: actual.total } : null,
  };
}

function solicitarTotal() {
  worker.pedirTotal();
}

// Resumen para la portada: si el refresh automático está andando, cuándo fue
// el último, cómo le fue y cuándo es el próximo.
async function resumen() {
  const [ultimo, ultimoCompleto] = await Promise.all([
    refreshRunsRepository.findLast(),
    refreshRunsRepository.findLastFull(),
  ]);
  return {
    auto: worker.estaActivo(),
    horas: env.refreshHours,
    proxy: !!env.proxyUrl,
    enCurso: batch.estadoActual(),
    totalEnCola: worker.totalEnCola(),
    ultimo,
    ultimoCompleto,
    proximo: worker.proximoRefresh(),
  };
}

module.exports = { solicitar, estado, solicitarTotal, resumen };
