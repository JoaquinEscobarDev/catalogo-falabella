const refreshRequestsRepository = require('../repositories/refreshRequestsRepository');
const categoriesRepository = require('../repositories/categoriesRepository');

// "Actualizar precios" deja la solicitud para que la PC la procese (ver
// scripts/watch-refresh.js) — el servidor no puede scrapear Falabella de
// forma confiable por sí solo.
async function solicitar(categoria) {
  const categoryId = await categoriesRepository.findOrCreateIdByName(categoria);
  return refreshRequestsRepository.create(categoryId);
}

async function estado(id) {
  const procesado = await refreshRequestsRepository.getStatus(id);
  if (procesado === null) {
    const err = new Error('No existe');
    err.status = 404;
    throw err;
  }
  return procesado;
}

module.exports = { solicitar, estado };
