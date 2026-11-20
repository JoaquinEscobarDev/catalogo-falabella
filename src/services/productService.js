const env = require('../config/env');
const productsRepository = require('../repositories/productsRepository');
const categoriesRepository = require('../repositories/categoriesRepository');
const priceHistoryRepository = require('../repositories/priceHistoryRepository');
const scraperService = require('./scraperService');
const couponService = require('./couponService');

async function listAll() {
  return productsRepository.findAll();
}

async function create(sku, alias, categoria, subcategoria) {
  if (await productsRepository.existsBySku(sku)) {
    const err = new Error('El SKU ya existe');
    err.status = 409;
    throw err;
  }
  const categoryId = await categoriesRepository.findOrCreateIdByName(categoria);
  await productsRepository.insert(sku, alias, categoryId, subcategoria);
}

async function remove(sku) {
  await productsRepository.remove(sku);
}

async function findByCategory(nombreCategoria) {
  const [items, cupones] = await Promise.all([
    productsRepository.findByCategoryName(nombreCategoria),
    couponService.vigentes(),
  ]);
  return items.map(i => ({
    ...i,
    producto: couponService.decorar(i.producto, i.sku, nombreCategoria, cupones),
  }));
}

// Agrega los cupones aplicables (con precio final calculado) a un producto.
async function conCupones(sku, producto) {
  const [categoria, cupones] = await Promise.all([
    productsRepository.getCategoryName(sku),
    couponService.vigentes(),
  ]);
  return couponService.decorar(producto, sku, categoria, cupones);
}

// Endpoint on-demand (click en un producto): sirve caché si es reciente, si no
// intenta scrapear en vivo (curl + Playwright de respaldo) y cae de nuevo al
// caché si el scraping falla, aunque esté viejo.
async function getProducto(sku, opts = {}) {
  return conCupones(sku, await getProductoSinCupones(sku, opts));
}

async function getProductoSinCupones(sku, { force } = {}) {
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
    // Se relee de la base para devolver también lo que no viene del scraping (UPC).
    const guardado = await productsRepository.getPriceData(sku).catch(() => null);
    if (guardado) return guardado;
    const { cupon, ...resto } = producto;
    return { ...resto, cuponDetectado: cupon || null, cached: true, updatedAt: new Date().toISOString() };
  }

  const cached = await productsRepository.getPriceData(sku);
  if (cached) return cached;

  const err = new Error('Producto no encontrado para ese SKU');
  err.status = 404;
  throw err;
}

async function guardarPrecios(sku, producto) {
  const previo = await productsRepository.getPreviousPrices(sku);
  // El primer scrape de un SKU (sin precios previos) no cuenta como cambio.
  const teniaPrecio = previo && (previo.precio_normal != null || previo.precio_oferta != null || previo.precio_cmr != null);
  const cambio = teniaPrecio
    ? (previo.precio_normal !== producto.precio || previo.precio_oferta !== producto.precioOferta || previo.precio_cmr !== producto.precioCMR)
    : false;
  if (cambio) await priceHistoryRepository.recordChanges(sku, previo, producto);
  await productsRepository.setPriceData(sku, producto);
  return { cambio, previo };
}

// Usado por el refresh masivo. `fetchFn` decide cómo se trae el HTML:
//   - fetchConPlaywrightFallback (default): curl y, si Cloudflare bloquea,
//     browser real. Es lo que usa el servidor.
//   - fetchDirectoConReintentos: solo curl, para correr desde una IP residencial.
async function refreshSku(sku, fetchFn = scraperService.fetchConPlaywrightFallback) {
  const { producto, viaDirecta } = await scraperService.scrapeProducto(sku, fetchFn);
  if (!producto) return { ok: false };

  const { cambio, previo } = await guardarPrecios(sku, producto);
  return { ok: true, viaDirecta, cambio, producto, previo };
}

async function search(q) {
  if (!q || q.trim().length < 2) return [];
  const [resultados, cupones] = await Promise.all([
    productsRepository.search(q.trim()),
    couponService.vigentes(),
  ]);
  return resultados.map(p => couponService.decorar(p, p.sku, p.categoria, cupones));
}

async function setUpc(sku, upc) {
  await productsRepository.setUpc(sku, upc);
}

module.exports = { listAll, create, remove, findByCategory, getProducto, refreshSku, search, setUpc };
