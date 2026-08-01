const env = require('../config/env');
const stockRepository = require('../repositories/stockRepository');
const scraperService = require('./scraperService');

async function getStock(sku) {
  const cached = await stockRepository.get(sku);
  if (cached && Date.now() - new Date(cached.updated_at).getTime() < env.stockTtlMs) {
    return { stock: cached.stock, storeName: cached.store_name };
  }

  try {
    const resultado = await scraperService.fetchStockEnVivo(sku);
    await stockRepository.set(sku, resultado.stock, resultado.storeName).catch(() => {});
    return resultado;
  } catch (e) {
    // Si falla el scraping pero hay caché vieja, mejor mostrar eso que nada
    if (cached) return { stock: cached.stock, storeName: cached.store_name };
    throw e;
  }
}

module.exports = { getStock };
