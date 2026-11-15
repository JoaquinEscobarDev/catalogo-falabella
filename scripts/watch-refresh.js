// OPCIONAL — el servidor ya hace esto solo (src/jobs/refreshWorker.js).
//
// Atiende desde esta máquina las solicitudes del botón "Actualizar precios".
// Solo tiene sentido si el servidor corre con AUTO_REFRESH=0.
//
// Uso: node scripts/watch-refresh.js

process.env.WORKER_ORIGEN = 'remoto'; // para la bitácora: no lo corrió el servidor

const db = require('../src/config/database');
const batch = require('../src/services/batchRefreshService');
const scraperService = require('../src/services/scraperService');

batch.procesarSolicitudesPendientes({
  fetchFn: scraperService.fetchDirectoConReintentos,
  log: console.log,
})
  .then(() => db.end())
  .catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
