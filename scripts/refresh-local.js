// OPCIONAL — el servidor ya hace esto solo (src/jobs/refreshWorker.js).
//
// Refresca los precios de todos los SKUs desde esta máquina. Queda como plan
// B por si el servidor está bloqueado por Falabella y se quiere forzar una
// corrida desde una IP residencial (necesita DATABASE_URL apuntando a la base).
//
// Uso: node scripts/refresh-local.js

process.env.WORKER_ORIGEN = 'remoto'; // para la bitácora: no lo corrió el servidor

const db = require('../src/config/database');
const batch = require('../src/services/batchRefreshService');
const scraperService = require('../src/services/scraperService');

batch.refreshTotal({
  tipo: 'manual',
  limpiar: true, // deja en la lista solo los cambios de esta corrida
  fetchFn: scraperService.fetchDirectoConReintentos,
  log: console.log,
})
  .then(() => db.end())
  .catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
