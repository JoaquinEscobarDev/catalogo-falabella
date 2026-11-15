// Refresh masivo de precios + stock. Lo usa el worker del servidor
// (src/jobs/refreshWorker.js) y también los scripts manuales de scripts/.

const db = require('../config/database');
const env = require('../config/env');
const productService = require('./productService');
const stockService = require('./stockService');
const productsRepository = require('../repositories/productsRepository');
const refreshRequestsRepository = require('../repositories/refreshRequestsRepository');
const refreshRunsRepository = require('../repositories/refreshRunsRepository');

const PAUSA_MS = parseInt(process.env.REFRESH_PAUSA_MS, 10) || 400; // ritmo prudente, no hay apuro
// Tantos productos seguidos sin poder leerse = Falabella está bloqueando a
// este servidor. Se corta la corrida en vez de insistir con cientos de SKUs.
const FALLOS_SEGUIDOS_PARA_CORTAR = 12;

// Qué se está refrescando ahora mismo (en memoria, para mostrar avance en la web).
let enCurso = null;
function estadoActual() { return enCurso ? { ...enCurso } : null; }

const ahora = () => new Date().toLocaleString('es-CL');

// Cuántos productos se leen a la vez. El servidor va de a uno (su respaldo es
// un único browser); el worker remoto, que solo usa curl, va de a varios.
// REFRESH_CONCURRENCIA lo cambia.
const CONCURRENCIA = Math.min(8, Math.max(1,
  parseInt(process.env.REFRESH_CONCURRENCIA, 10) || (env.workerOrigen === 'remoto' ? 4 : 1)
));

async function refrescarSkus(skus, { fetchFn, conStock = true, antesDelPrimerOk, onAvance, log = () => {} } = {}) {
  const r = { ok: 0, fail: 0, cambios: 0, viaDirecta: 0, bloqueado: false };
  let fallosSeguidos = 0;
  let siguiente = 0;   // próximo índice a tomar
  let hechos = 0;      // productos terminados (bien o mal)
  let cortar = false;
  let limpieza = null; // promesa de antesDelPrimerOk: corre una sola vez

  async function carril() {
    while (!cortar) {
      const i = siguiente++;
      if (i >= skus.length) return;
      const sku = skus[i];
      try {
        const res = await productService.refreshSku(sku, fetchFn);
        if (!res.ok) throw new Error('sin datos');
        if (antesDelPrimerOk) await (limpieza ||= antesDelPrimerOk());
        r.ok++;
        fallosSeguidos = 0;
        if (res.viaDirecta) r.viaDirecta++;
        if (res.cambio) r.cambios++;
        log(`  OK   ${sku} - ${res.producto.nombre} - $${res.producto.precio || res.producto.precioOferta || '?'}${res.cambio ? ' (precio cambió)' : ''}${res.producto.cupon ? ' (cupón)' : ''}`);
        if (conStock) await stockService.refreshStock(sku).catch(() => {});
      } catch (e) {
        r.fail++;
        fallosSeguidos++;
        log(`  FAIL ${sku} - ${e.message}`);
      }
      hechos++;
      if (onAvance) await onAvance(hechos, r);
      if (fallosSeguidos >= FALLOS_SEGUIDOS_PARA_CORTAR && !cortar) {
        cortar = true;
        log(`  Cortado: ${fallosSeguidos} productos seguidos sin respuesta (bloqueo de Falabella).`);
      }
      if (!cortar && siguiente < skus.length) await new Promise(res => setTimeout(res, PAUSA_MS));
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, skus.length) }, carril));

  if (cortar) {
    r.bloqueado = true;
    r.fail += skus.length - hechos; // los que quedaron sin intentar
  }
  // No se pudo leer ni un producto: para el usuario es lo mismo que un bloqueo.
  if (skus.length && r.ok === 0) r.bloqueado = true;
  return r;
}

// Refresh completo de todos los SKUs.
//   tipo: 'diario' (programado) | 'manual' (botón "Actualizar todo")
//   limpiar: marca como vistos los cambios de precio anteriores y vacía el
//            ToDo, para que la lista muestre solo los cambios de hoy. Recién
//            se hace cuando el primer producto se leyó bien, así un bloqueo
//            no borra la lista sin traer nada nuevo.
async function refreshTotal({ tipo = 'diario', limpiar = false, fetchFn, log = () => {} } = {}) {
  const skus = await productsRepository.findAllSkus();
  log(`[${ahora()}] Refrescando ${skus.length} SKUs (${tipo})...`);
  const runId = await refreshRunsRepository.start(tipo, null, skus.length, env.workerOrigen);
  enCurso = { tipo, detalle: null, solicitudId: null, total: skus.length, hechos: 0, ok: 0, fail: 0 };

  let r = { ok: 0, fail: 0, cambios: 0, viaDirecta: 0, bloqueado: false };
  let estado = 'error';
  try {
    r = await refrescarSkus(skus, {
      fetchFn, log,
      antesDelPrimerOk: limpiar ? async () => {
        await db.query('UPDATE price_history SET visto = TRUE WHERE visto = FALSE');
        await db.query('DELETE FROM todo_items');
      } : null,
      onAvance: async (hechos, parcial) => {
        Object.assign(enCurso, { hechos, ok: parcial.ok, fail: parcial.fail });
        if (hechos % 5 === 0) await refreshRunsRepository.progress(runId, parcial).catch(() => {});
      },
    });
    estado = r.bloqueado ? 'bloqueado' : 'ok';
  } finally {
    enCurso = null;
    await refreshRunsRepository.finish(runId, { ...r, estado }).catch(() => {});
  }
  log(`[${ahora()}] Listo: ${r.ok} OK (${r.viaDirecta} vía página directa, ${r.cambios} con cambio de precio) / ${r.fail} FAIL de ${skus.length}${r.bloqueado ? ' — BLOQUEADO' : ''}`);
  return r;
}

// Atiende las solicitudes del botón "Actualizar precios" de una categoría.
async function procesarSolicitudesPendientes({ fetchFn, log = () => {} } = {}) {
  const solicitudes = await refreshRequestsRepository.findPending();

  for (const { id, categoria } of solicitudes) {
    log(`[${ahora()}] Procesando solicitud #${id} (${categoria})...`);
    // Se marca como tomada antes de empezar, para que otro proceso no la repita.
    await refreshRequestsRepository.markProcessed(id);

    const skus = await productsRepository.findSkusByCategoryName(categoria);
    const runId = await refreshRunsRepository.start('categoria', categoria, skus.length, env.workerOrigen);
    enCurso = { tipo: 'categoria', detalle: categoria, solicitudId: id, total: skus.length, hechos: 0, ok: 0, fail: 0 };

    let r = { ok: 0, fail: 0, cambios: 0, bloqueado: false };
    let estado = 'error';
    try {
      r = await refrescarSkus(skus, {
        fetchFn, log,
        onAvance: async (hechos, parcial) => {
          Object.assign(enCurso, { hechos, ok: parcial.ok, fail: parcial.fail });
          // Se guarda seguido: la web lee el avance desde la base cuando el
          // trabajo lo hace otro proceso (worker remoto).
          if (hechos % 3 === 0) await refreshRunsRepository.progress(runId, parcial).catch(() => {});
        },
      });
      estado = r.bloqueado ? 'bloqueado' : 'ok';
    } finally {
      enCurso = null;
      await refreshRunsRepository.finish(runId, { ...r, estado }).catch(() => {});
      await refreshRequestsRepository.markFinished(id, r.ok, r.fail).catch(() => {});
    }
    log(`  Listo: ${r.ok} OK / ${r.fail} FAIL de ${skus.length}`);
  }
  return solicitudes.length;
}

module.exports = { refrescarSkus, refreshTotal, procesarSolicitudesPendientes, estadoActual };
