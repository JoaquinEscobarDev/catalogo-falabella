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
const { extraerPlanesConnect, urlPlanes } = require('./connectPlanesParser');

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

const COMPANIAS = [['Entel', /\bentel\b/i], ['Movistar', /\bmovistar\b/i], ['WOM', /\bwom\b/i], ['Claro', /\bclaro\b/i]];

// Primera imagen del producto, en un tamaño razonable para la lista.
function imagenDe(item) {
  let url = item.mediaUrls?.[0] || item.media?.[0]?.url || item.media?.url || item.mediaUrl || null;
  if (url && typeof url === 'object') url = url.url || null;
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('//')) url = `https:${url}`;
  return url.includes('?') ? url : `${url}?width=300&height=300&fit=inside`;
}

// Características principales: topSpecifications viene como lista de
// { name, value } (o variantes de esos nombres) o de textos sueltos.
function specsDe(item) {
  const lista = item.topSpecifications || item.specifications || [];
  const out = [];
  for (const s of Array.isArray(lista) ? lista : []) {
    if (typeof s === 'string') { out.push({ nombre: null, valor: s }); continue; }
    const nombre = s?.name ?? s?.label ?? s?.key ?? null;
    const valor = s?.value ?? s?.values?.[0] ?? s?.text ?? null;
    if (valor != null && String(valor).trim()) out.push({ nombre: nombre ? String(nombre) : null, valor: String(valor) });
    if (out.length >= 6) break;
  }
  return out;
}

// Valores por compañía, si el producto los trae: busca objetos que nombran
// una compañía y lee el precio del equipo (pie) y el valor mensual.
function operadoresDe(nodo) {
  const res = {};
  let n = 0;
  (function visitar(v, prof) {
    if (!v || typeof v !== 'object' || prof > 8 || n++ > 5000) return;
    if (!Array.isArray(v)) {
      const textos = Object.values(v).filter(x => typeof x === 'string').join(' ');
      const comp = (COMPANIAS.find(([, re]) => re.test(textos)) || [null])[0];
      if (comp && !res[comp]) {
        let pie = null, mensual = null;
        for (const [k, x] of Object.entries(v)) {
          const num = Array.isArray(x) ? aNumero(x[0]?.rawPrice ?? x[0]?.price ?? x[0]) : (typeof x === 'object' ? null : aNumero(x));
          if (/mensual|monthly|month|cuota|fee|cargo/i.test(k) && num) mensual = num;
          else if (/pie|equipo|device|price|precio/i.test(k)) {
            const p = Array.isArray(x) ? (menorPrecio(x)?.precio ?? num) : num;
            if (p) pie = p;
          }
        }
        if (pie || mensual) res[comp] = { pie, mensual };
      }
    }
    for (const x of Object.values(v)) visitar(x, prof + 1);
  })(nodo, 0);
  return Object.keys(res).length ? res : null;
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
      imagen: imagenDe(item),
      specs: specsDe(item),
      operadores: operadoresDe(item),
      urlPlanes: urlPlanes(url, env.falabellaBaseUrl, item.productId, item.skuId),
    });
  }
  return { ofertas, total: pp.pagination?.count ?? null, hayDatos: true };
}

// Abre la página de planes de cada equipo y guarda, por compañía, el plan
// más barato (pie, mensual, gigas...) y la lista de planes. De a varios a la
// vez; si fallan muchos seguidos (bloqueo), deja de intentar.
const PLANES_CONCURRENCIA = 4;
async function leerPlanesPorEquipo(ofertas, fetchFn, log) {
  const pendientes = ofertas.filter(o => o.urlPlanes);
  let i = 0, hechos = 0, conPlanes = 0, fallosSeguidos = 0, cortar = false;
  async function carril() {
    while (!cortar) {
      const o = pendientes[i++];
      if (!o) return;
      try {
        const r = extraerPlanesConnect(await fetchFn(o.urlPlanes));
        if (r.porCompania) { o.operadores = r.porCompania; conPlanes++; }
        fallosSeguidos = 0;
      } catch {
        if (++fallosSeguidos >= 8) cortar = true;
      }
      if (++hechos % 15 === 0) log(`Connect: planes leídos de ${hechos}/${pendientes.length} equipos...`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PLANES_CONCURRENCIA, pendientes.length) }, carril));
  return { conPlanes, revisados: hechos, cortado: cortar };
}

async function buscar({ log = () => {}, fetchFn = scraperService.fetchDirectoConReintentos } = {}) {
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
  if (ofertas.length) {
    const p = await leerPlanesPorEquipo(ofertas, fetchFn, log);
    resumen.conPlanes = p.conPlanes;
    log(`Connect: planes por compañía de ${p.conPlanes} de ${ofertas.length} equipos${p.cortado ? ' (cortado: demasiados fallos seguidos)' : ''}.`);
  }
  // Solo se reemplaza si se leyó algo: un bloqueo no borra lo anterior
  // (y lo anterior deja de mostrarse solo a los 3 días).
  if (ofertas.length) await connectRepository.reemplazarOfertas(ofertas);
  await workerStateRepository.guardar(CLAVE_RESUMEN, JSON.stringify(resumen)).catch(() => {});
  log(resumen.ok || ofertas.length
    ? `Connect: ${ofertas.length} equipos con plan leídos de la colección Falabella Connect.`
    : `Connect: no se pudo leer la colección Falabella Connect (${resumen.error}).`);
  return { resumen, ofertas };
}

module.exports = { buscar, extraerOfertasConnect, menorPrecio, operadoresDe, specsDe };
