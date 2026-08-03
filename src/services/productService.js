const env = require('../config/env');
const productsRepository = require('../repositories/productsRepository');
const categoriesRepository = require('../repositories/categoriesRepository');
const priceHistoryRepository = require('../repositories/priceHistoryRepository');
const scraperService = require('./scraperService');

async function listAll() {
  return productsRepository.findAll();
}

async function create(sku, alias, categoria) {
  if (await productsRepository.existsBySku(sku)) {
    const err = new Error('El SKU ya existe');
    err.status = 409;
    throw err;
  }
  const categoryId = await categoriesRepository.findOrCreateIdByName(categoria);
  await productsRepository.insert(sku, alias, categoryId);
}

async function remove(sku) {
  await productsRepository.remove(sku);
}

async function findByCategory(nombreCategoria) {
  return productsRepository.findByCategoryName(nombreCategoria);
}

// Endpoint on-demand (click en un producto): sirve caché si es reciente, si no
// intenta scrapear en vivo (curl + Playwright de respaldo) y cae de nuevo al
// caché si el scraping falla, aunque esté viejo.
async function getProducto(sku, { force } = {}) {
  if (!force) {
    const cached = await productsRepository.getPriceData(sku);
    if (cached?.updatedAt) {
      const age = Date.now() - new Date(cached.updatedAt).getTime();
      if (age < env.cacheTtlMs) return cached;
    }
  }

  let producto = null;
  try {
    const r = await scraperService.scrapeProducto(sku, scraperService.fetchConPlaywrightFallback);
    producto = r.producto;
  } catch (e) {
    console.log(`Scraping falló para ${sku}: ${e.message}`);
  }

  if (producto) {
    await guardarPrecios(sku, producto).catch(() => {});
    return { ...producto, cached: true, updatedAt: new Date().toISOString() };
  }

  const cached = await productsRepository.getPriceData(sku);
  if (cached) return cached;

  const err = new Error('Producto no encontrado para ese SKU');
  err.status = 404;
  throw err;
}

async function guardarPrecios(sku, producto) {
  const previo = await productsRepository.getPreviousPrices(sku);
  const cambio = previo
    ? (previo.precio_normal !== producto.precio || previo.precio_oferta !== producto.precioOferta || previo.precio_cmr !== producto.precioCMR)
    : false;
  if (cambio) await priceHistoryRepository.recordChanges(sku, previo, producto);
  await productsRepository.setPriceData(sku, producto);
  return cambio;
}

// Usado por los scripts de refresh masivo (PC, IP residencial): scrapea solo
// con curl (sin Playwright) y devuelve un resumen para loguear.
async function refreshSku(sku) {
  const { producto, viaDirecta } = await scraperService.scrapeProducto(sku, scraperService.fetchDirectoConReintentos);
  if (!producto) return { ok: false };

  const cambio = await guardarPrecios(sku, producto);
  return { ok: true, viaDirecta, cambio, producto };
}

async function search(q) {
  if (!q || q.trim().length < 2) return [];
  return productsRepository.search(q.trim());
}

async function setUpc(sku, upc) {
  await productsRepository.setUpc(sku, upc);
}

module.exports = { listAll, create, remove, findByCategory, getProducto, refreshSku, search, setUpc };
