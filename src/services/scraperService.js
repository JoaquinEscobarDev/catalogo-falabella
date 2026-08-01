// Scraping + parsing de Falabella. Sin acceso a base de datos — devuelve
// datos planos, la persistencia y el diff de precios los maneja productService.
//
// Dos formas de traer HTML:
//   - fetchDirectoConReintentos: solo curl, con reintentos. Pensado para correr
//     desde una IP residencial (scripts/refresh-local.js, scripts/watch-refresh.js)
//     donde casi siempre alcanza.
//   - fetchConPlaywrightFallback: curl primero, y si Cloudflare bloquea, cae a
//     un browser real con stealth (+ proxy opcional). Pensado para el endpoint
//     on-demand del servidor, que puede correr en una IP de datacenter.
//
// OJO: el fetch nativo de Node tiene un fingerprint TLS distinto al de curl,
// y Cloudflare lo bloquea (403) aunque sea la misma IP y los mismos headers
// que un curl que sí pasa. Por eso todo esto usa el binario curl real.

const { execFile } = require('child_process');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const env = require('../config/env');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function curlFetch(url, useProxy = false) {
  const args = [
    '-sL',
    '-H', `User-Agent: ${USER_AGENT}`,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    '-H', 'Accept-Language: es-CL,es;q=0.9,en;q=0.8',
    '--max-time', '20',
  ];
  if (useProxy && env.proxyUrl) args.push('--proxy', env.proxyUrl);
  args.push(url);

  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.message));
      if (!stdout || !stdout.includes('__NEXT_DATA__')) return reject(new Error('BLOCKED'));
      resolve(stdout);
    });
  });
}

async function fetchDirectoConReintentos(url, intentos = 2) {
  for (let i = 1; i <= intentos; i++) {
    try {
      return await curlFetch(url);
    } catch { /* reintenta */ }
    if (i < intentos) await new Promise(res => setTimeout(res, 1500));
  }
  throw new Error('BLOCKED');
}

// ── Playwright (solo para el endpoint on-demand del servidor) ──

// Limita Playwright a un browser a la vez para no explotar RAM.
let playwrightBusy = false;
const playwrightQueue = [];
function playwrightSlot() {
  return new Promise(resolve => {
    if (!playwrightBusy) { playwrightBusy = true; resolve(); }
    else playwrightQueue.push(resolve);
  });
}
function playwrightRelease() {
  const next = playwrightQueue.shift();
  if (next) next();
  else playwrightBusy = false;
}

// Circuit breaker: solo si fallan muchos SKUs seguidos (proxy/cuenta caída), pausa 10 min.
// Una sola IP bloqueada por Cloudflare es normal y no debe frenar el resto del batch.
const PLAYWRIGHT_FAIL_THRESHOLD = 5;
let playwrightConsecutiveFails = 0;
let playwrightBlocked = false;
let playwrightBlockedUntil = 0;
function playwrightIsBlocked() {
  if (!playwrightBlocked) return false;
  if (Date.now() > playwrightBlockedUntil) { playwrightBlocked = false; playwrightConsecutiveFails = 0; return false; }
  return true;
}
function playwrightMarkFailure() {
  playwrightConsecutiveFails++;
  if (playwrightConsecutiveFails >= PLAYWRIGHT_FAIL_THRESHOLD) {
    playwrightBlocked = true;
    playwrightBlockedUntil = Date.now() + 10 * 60 * 1000;
    console.log(`Playwright falló ${playwrightConsecutiveFails} veces seguidas, bloqueado 10 min, usando caché`);
  }
}
function playwrightMarkSuccess() {
  playwrightConsecutiveFails = 0;
}

// Parsea user:pass embebidos en la URL del proxy al formato que espera Playwright
function buildProxyConfig(proxyUrlStr) {
  if (!proxyUrlStr) return undefined;
  const u = new URL(proxyUrlStr);
  return {
    server: `${u.protocol}//${u.host}`,
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

async function playwrightFetch(url) {
  await playwrightSlot();
  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
    ],
  };
  const proxy = buildProxyConfig(env.proxyUrl);
  if (proxy) launchOpts.proxy = proxy;

  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1920, height: 1080 },
      locale: 'es-CL',
      extraHTTPHeaders: { 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' },
    });
    const page = await context.newPage();
    // Probado bloquear imagenes/fuentes para ahorrar proxy: rompe el challenge de
    // Cloudflare (vuelve a servir 403 "Un momento..."). No tocar resourceType.
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForFunction(
      () => document.getElementById('__NEXT_DATA__') !== null,
      { timeout: 10000 }
    ).catch(() => {});
    return await page.content();
  } finally {
    await browser.close();
    playwrightRelease();
  }
}

// Reintentos de Playwright: el proxy rota de IP en cada conexión nueva,
// así que una IP marcada por Cloudflare en un intento no se repite en los siguientes.
const PLAYWRIGHT_RETRIES = env.proxyUrl ? 5 : 1;

async function fetchConPlaywrightFallback(url) {
  try {
    return await curlFetch(url, true);
  } catch (e) {
    if (e.message !== 'BLOCKED' && !e.message.includes('403')) throw e;
    if (playwrightIsBlocked()) throw new Error('BLOCKED');

    for (let attempt = 1; attempt <= PLAYWRIGHT_RETRIES; attempt++) {
      console.log(`curl bloqueado para ${url}, usando playwright (intento ${attempt}/${PLAYWRIGHT_RETRIES})...`);
      try {
        const html = await playwrightFetch(url);
        playwrightMarkSuccess();
        return html;
      } catch (pe) {
        if (attempt === PLAYWRIGHT_RETRIES) {
          playwrightMarkFailure();
          throw new Error('BLOCKED');
        }
      }
    }
  }
}

// ── Parsing de __NEXT_DATA__ ──

function parsePrecio(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? null : n;
}

// Falabella ofrece varias promos de cuotas sin interés a la vez, algunas solo
// para clientes de cierto segmento bancario (userSegment). Para no prometer
// algo que no aplica a cualquier cliente, se toma el máximo de cuotas entre
// las que usan CMR y no tienen restricción de segmento.
function extraerCuotasSinInteres(pd) {
  const opciones = pd?.installmentsWithoutInterest || [];
  const validas = opciones.filter(o =>
    o.paymentMethods?.includes('CMR_CREDIT_CARD') && (!o.userSegment || o.userSegment.length === 0)
  );
  if (!validas.length) return null;
  return Math.max(...validas.map(o => o.installments));
}

// "Despacho 24 horas" = envío a domicilio que llega al día siguiente
// (meatSticker tipo "next_day"). "cc_next_day" es retiro en tienda, no cuenta.
function extraerDespacho24h(meatStickers) {
  return (meatStickers || []).some(s => s.type === 'next_day');
}

// El nombre del producto (pd.name) es genérico y no trae GB ni color — esos
// datos están solo en attributes.size de la variante elegida. En resultados
// de búsqueda no hay attributes, ahí se sacan del nombre.
function extraerCapacidad(nombre, attributes) {
  if (attributes?.size) return attributes.size;
  const m = (nombre || '').match(/(\d+\s?(?:GB|TB))/i);
  return m ? m[1].replace(/\s+/g, ' ').toUpperCase() : null;
}

const COLORES_CONOCIDOS = [
  'negro', 'blanco', 'azul', 'gris', 'celeste', 'morado', 'violeta', 'lila',
  'rosado', 'rosa', 'rojo', 'verde', 'dorado', 'plateado', 'plata', 'titanio',
  'naranjo', 'amarillo', 'fucsia', 'beige', 'cobre', 'turquesa', 'crema',
];
function extraerColorDeNombre(nombre) {
  const palabras = (nombre || '').toLowerCase().split(/\s+/);
  for (let i = palabras.length - 1; i >= 0; i--) {
    const palabra = palabras[i].replace(/[^a-záéíóúñ]/g, '');
    if (COLORES_CONOCIDOS.includes(palabra)) {
      return palabra.charAt(0).toUpperCase() + palabra.slice(1);
    }
  }
  return null;
}

// La garantía extendida (1/2/3 años) solo viene en la página de producto
// (productData), no en los listados de búsqueda. Toma el precio de oferta
// si lo hay, sino el primero disponible.
function extraerGarantias(pd) {
  const opciones = pd?.warrantyOptions?.fieldOptions || [];
  const resultado = { garantia1a: null, garantia2a: null, garantia3a: null };
  for (const op of opciones) {
    const m = (op.name || '').match(/^(\d+)\s*año/i);
    if (!m) continue;
    const anios  = parseInt(m[1], 10);
    const oferta = op.prices?.find(p => p.type === 'internetPrice');
    const precio = parsePrecio(oferta?.price?.[0]) ?? parsePrecio(op.prices?.[0]?.price?.[0]) ?? parsePrecio(op.textPrice);
    if (anios === 1) resultado.garantia1a = precio;
    if (anios === 2) resultado.garantia2a = precio;
    if (anios === 3) resultado.garantia3a = precio;
  }
  return resultado;
}

function extraerDeProductData(pd, skuBuscado) {
  const variante = pd.variants?.find(v => v.id === skuBuscado) || pd.variants?.[0] || {};
  const precios  = variante.prices || [];
  const normal   = precios.find(p => p.type === 'normalPrice');
  const oferta   = precios.find(p => p.type === 'internetPrice' || p.type === 'offerPrice');
  const cmr      = precios.find(p => p.type === 'cmrPrice');
  const precioN  = parsePrecio(normal?.price?.[0]);
  const precioO  = parsePrecio(oferta?.price?.[0]);
  const precioCMR = parsePrecio(cmr?.price?.[0]);
  const imagenes = (variante.medias || []).filter(m => m.mediaType === 'image');
  const imagen   = imagenes[0]?.url ? `${imagenes[0].url}?width=500&height=500&fit=inside` : null;
  return {
    nombre: pd.name, sku: variante.id || skuBuscado, marca: pd.brandName,
    precio: precioN,
    precioOferta: precioO && precioO !== precioN ? precioO : null,
    precioCMR: precioCMR && precioCMR !== precioN && precioCMR !== precioO ? precioCMR : null,
    imagen,
    url: pd.slug ? `https://www.falabella.com/falabella-cl/product/${pd.id}/${pd.slug}` : null,
    // Cuando el producto no tiene variantes de color/tamaño (un solo SKU),
    // Falabella no llena attributes.size/colorName — ahí se sacan del nombre
    // interno de la variante (ej. "SAMSUNG GALAXY A17 128GB NEGRO").
    capacidad: extraerCapacidad(pd.name, variante.attributes) || extraerCapacidad(variante.name, null),
    color: variante.attributes?.colorName || extraerColorDeNombre(variante.name),
    cuotasSinInteres: extraerCuotasSinInteres(pd),
    despacho24h: extraerDespacho24h(variante.meatStickers),
    ...extraerGarantias(pd),
  };
}

function extraerDeSearchResult(item, skuBuscado) {
  const precios = item.prices || [];
  const normal  = precios.find(p => p.type === 'normalPrice');
  const oferta  = precios.find(p => p.type === 'internetPrice' || p.type === 'offerPrice');
  const cmr     = precios.find(p => p.type === 'cmrPrice');
  const precioN = parsePrecio(normal?.price?.[0]) || parsePrecio(item.prices?.[0]?.price?.[0]);
  const precioO = parsePrecio(oferta?.price?.[0]);
  const precioCMR = parsePrecio(cmr?.price?.[0]);
  const imagen = item.mediaUrl || item.image || item.mediaUrls?.[0] || null;
  // La búsqueda por texto libre devuelve productId/skuId y url absoluta; la
  // búsqueda por número de SKU devuelve id y url relativa. Soportar ambas.
  const nombre = item.displayName || item.name;
  return {
    nombre, sku: item.id || item.skuId || item.productId || skuBuscado, marca: item.brand,
    precio: precioN,
    precioOferta: precioO && precioO !== precioN ? precioO : null,
    precioCMR: precioCMR && precioCMR !== precioN && precioCMR !== precioO ? precioCMR : null,
    imagen,
    url: item.url ? (item.url.startsWith('http') ? item.url : `https://www.falabella.com${item.url}`) : null,
    capacidad: extraerCapacidad(nombre, null),
    color: extraerColorDeNombre(nombre),
    despacho24h: extraerDespacho24h(item.meatStickers),
    // Los listados de búsqueda no traen warrantyOptions ni installmentsWithoutInterest.
    cuotasSinInteres: null,
    garantia1a: null, garantia2a: null, garantia3a: null,
  };
}

function extraerDeHTML(html, skuBuscado) {
  try {
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return null;
    const data      = JSON.parse(m[1]);
    const pageProps = data?.props?.pageProps;
    const pd        = pageProps?.productData;
    if (pd && (pd.id === skuBuscado || pd.variants?.some(v => v.id === skuBuscado))) {
      return extraerDeProductData(pd, skuBuscado);
    }
    const results = pageProps?.initialData?.state?.results || pageProps?.searchResult?.state?.results || pageProps?.results;
    if (results) {
      for (const item of results) {
        if (item.id === skuBuscado || item.skuId === skuBuscado || item.productId === skuBuscado || item.skus?.some(s => s.skuId === skuBuscado)) {
          return extraerDeSearchResult(item, skuBuscado);
        }
      }
      if (results[0]) return extraerDeSearchResult(results[0], skuBuscado);
    }
    return null;
  } catch (e) {
    console.error('Error parseando HTML:', e.message);
    return null;
  }
}

// Sin validar que pd.id coincida con el SKU buscado: ya se construyó la URL a
// propósito con el product ID adivinado (SKU - 1), así que si hay productData
// se confía en que es el producto correcto.
function extraerDirectoSinValidarId(html, skuBuscado) {
  try {
    const m  = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return null;
    const pd = JSON.parse(m[1])?.props?.pageProps?.productData;
    return pd ? extraerDeProductData(pd, skuBuscado) : null;
  } catch {
    return null;
  }
}

// Productos sin stock quedan fuera de la búsqueda (Ntt=) pero la página
// directa del producto los sigue mostrando. El slug no importa, Falabella
// resuelve por el ID — por eso "x" funciona como slug cualquiera.
function urlBusqueda(sku) {
  return `https://www.falabella.com/falabella-cl/search?Ntt=${sku}`;
}
function urlDirecta(sku) {
  return `https://www.falabella.com/falabella-cl/product/${sku}/x/${sku}`;
}
function urlDirectaOffset(sku) {
  const productId = String(Number(sku) - 1);
  return `https://www.falabella.com/falabella-cl/product/${productId}/x/${sku}`;
}

// Algunos productos marketplace (ej. DDESIGN) no quedan indexados en el
// buscador y, además, su product ID real no es el SKU/variant ID que usamos
// para identificarlos sino ese número menos 1. Acotado a SKUs largos (9+
// dígitos) para no probarlo con SKUs propios de Falabella, donde
// productId === skuId y este truco daría un falso positivo.
function pareceMarketplaceLargo(sku) {
  return /^\d{9,}$/.test(sku);
}

// Busca el producto probando primero la búsqueda, luego la página directa y,
// como último recurso, la página directa con el ID desplazado (marketplace).
// `fetchFn(url)` es intercambiable: fetchDirectoConReintentos (PC/residencial)
// o fetchConPlaywrightFallback (servidor). Devuelve viaDirecta=true cuando el
// producto no salió en la búsqueda (típicamente porque no tiene stock).
async function scrapeProducto(sku, fetchFn) {
  try {
    const html = await fetchFn(urlBusqueda(sku));
    const producto = extraerDeHTML(html, sku);
    if (producto) return { producto, viaDirecta: false };
  } catch { /* sigue al fallback */ }

  try {
    const html = await fetchFn(urlDirecta(sku));
    const producto = extraerDeHTML(html, sku);
    if (producto) return { producto, viaDirecta: true };
  } catch { /* sigue al siguiente fallback */ }

  if (pareceMarketplaceLargo(sku)) {
    try {
      const html = await fetchFn(urlDirectaOffset(sku));
      const producto = extraerDirectoSinValidarId(html, sku);
      if (producto) return { producto, viaDirecta: true };
    } catch { /* no hay más intentos */ }
  }

  return { producto: null, viaDirecta: false };
}

// ── Stock en tienda ──

const STORE_ID  = '2617'; // Los Dominicos
const STORE_LAT = '-33.394';
const STORE_LON = '-70.551';

async function fetchStockEnVivo(sku) {
  const url = `https://www.falabella.com/s/geo/v1/stores/cl?offeringId=${sku}&sellerId=FALABELLA_CHILE&latitude=${STORE_LAT}&longitude=${STORE_LON}`;
  const stdout = await new Promise((resolve, reject) => {
    execFile('curl', [
      '-s', url,
      '-H', `User-Agent: ${USER_AGENT}`,
      '-H', 'Accept: application/json',
      '-H', 'Referer: https://www.falabella.com/',
      '--max-time', '10',
    ], { maxBuffer: 2 * 1024 * 1024 }, (err, out) => {
      if (err) return reject(err);
      resolve(out);
    });
  });
  const data   = JSON.parse(stdout);
  const stores = data?.stores || [];
  const tienda = stores.find(s => s.id === STORE_ID);
  if (!tienda) return { stock: null, storeName: 'Los Dominicos' };
  return { stock: tienda.stockQuantity?.number ?? null, storeName: tienda.storeName };
}

module.exports = {
  fetchDirectoConReintentos,
  fetchConPlaywrightFallback,
  scrapeProducto,
  fetchStockEnVivo,
  parsePrecio,
};
