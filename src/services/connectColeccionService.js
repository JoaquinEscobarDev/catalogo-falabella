// Lee la colección "Falabella Connect · Celulares con Plan" de falabella.com
// y guarda, por equipo, el precio más bajo del equipo cuando se lleva con un
// plan (campo lowestPlan de cada producto del listado). Corre al principio de
// cada refresh completo, junto con los cupones.
//
// Estructura vista en la página real (15-11-2026): pageProps.results es una
// lista de productos con skuId, productId, displayName, brand, prices, variants
// y lowestPlan: { price: [{ type: 'cmrPrice', rawPrice: ['189990'], price: ['189.990'] }] }.

const env = require('../config/env');
const scraperService = require('./scraperService');
const connectRepository = require('../repositories/connectRepository');
const workerStateRepository = require('../repositories/workerStateRepository');

const PATH = '/falabella-cl/collection/falabella-connect';
const MAX_PAGINAS = 6;
const CLAVE_RESUMEN = 'connect:coleccion';

function aNumero(v) {
  const n = parseInt(String(Array.isArray(v) ? v[0] : v ?? '').replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// El precio más bajo de una lista de precios de Falabella ({ type, price, rawPrice }).
function menorPrecio(precios) {
  let mejor = null;
  for (const p of precios || []) {
    const n = aNumero(p.rawPrice) ?? aNumero(p.price);
    if (n && (!mejor || n < mejor.precio)) mejor = { precio: n, tipo: p.type || null };
  }
  return mejor;
}

// Ids con los que un producto del listado puede coincidir con un SKU del
// catálogo: el del producto, el del SKU y los de sus variantes (colores).
function idsDe(item) {
  const ids = new Set([item.skuId, item.productId, item.id].filter(Boolean).map(String));
  for (const v of item.variants || []) {
    for (const x of [v?.id, v?.skuId, v?.productId]) if (x) ids.add(String(x));
    for (const o of v?.options || []) for (const x of [o?.id, o?.skuId, o?.mediaId]) if (x && /^\d{4,12}$/.test(String(x))) ids.add(String(x));
  }
  return [...ids].filter(id => /^\d{4,12}$/.test(id));
}

// Función pura: HTML de una página de la colección → ofertas + total.
function extraerOfertasConnect(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return { ofertas: [], total: null, hayDatos: false };
  let pp;
  try { pp = JSON.parse(m[1])?.props?.pageProps || {}; } catch { return { ofertas: [], total: null, hayDatos: false }; }
  const results = pp.results || pp.initialData?.state?.results || pp.searchResult?.state?.results || [];
  const ofertas = [];
  for (const item of results) {
    const conPlan = menorPrecio(item.lowestPlan?.price || item.lowestPlan?.prices);
    if (!conPlan) continue;
    const sinPlan = menorPrecio(item.prices);
    const url = item.url ? (item.url.startsWith('http') ? item.url : `${env.falabellaBaseUrl}${item.url}`) : null;
    ofertas.push({
      ids: idsDe(item),
      nombre: item.displayName || item.name || null,
      marca: item.brand || null,
      precioConPlan: conPlan.precio,
      tipoPrecio: conPlan.tipo,
      precioSinPlan: sinPlan ? sinPlan.precio : null,
      url,
      plan: item.lowestPlan,
    });
  }
  return { ofertas, total: pp.pagination?.count ?? null, hayDatos: true };
}

async function buscar({ log = () => {} } = {}) {
  const ofertas = [];
  const resumen = { en: new Date().toISOString(), ok: false, paginas: 0, equipos: 0, error: null };
  let total = null;
  try {
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const url = `${env.falabellaBaseUrl}${PATH}${pagina > 1 ? `?page=${pagina}` : ''}`;
      const { http, html } = await scraperService.fetchPagina(url, { useProxy: env.workerOrigen === 'servidor' });
      if (http !== 200) throw new Error(`HTTP ${http}`);
      const r = extraerOfertasConnect(html);
      if (!r.hayDatos) throw new Error('la página no trae datos internos');
      resumen.paginas = pagina;
      total = r.total ?? total;
      if (!r.ofertas.length) break;
      ofertas.push(...r.ofertas);
      if (total && ofertas.length >= total) break;
    }
    resumen.ok = true;
  } catch (e) {
    resumen.error = e.message;
  }

  resumen.equipos = ofertas.length;
  // Solo se reemplaza si se leyó algo: un bloqueo no borra lo anterior
  // (y lo anterior deja de mostrarse solo a los 3 días).
  if (ofertas.length) await connectRepository.reemplazarOfertas(ofertas);
  await workerStateRepository.guardar(CLAVE_RESUMEN, JSON.stringify(resumen)).catch(() => {});
  log(resumen.ok || ofertas.length
    ? `Connect: ${ofertas.length} equipos con plan leídos de la colección Falabella Connect.`
    : `Connect: no se pudo leer la colección Falabella Connect (${resumen.error}).`);
  return { resumen, ofertas };
}

module.exports = { buscar, extraerOfertasConnect, menorPrecio };
