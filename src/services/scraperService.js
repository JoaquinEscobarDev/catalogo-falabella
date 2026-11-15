// Scraping + parsing de Falabella. Sin acceso a base de datos — devuelve
// datos planos, la persistencia y el diff de precios los maneja productService.
//
// Dos formas de traer HTML:
//   - fetchDirectoConReintentos: solo curl, con reintentos. Pensado para correr
//     desde una IP residencial (scripts/refresh-local.js, scripts/watch-refresh.js)
//     donde casi siempre alcanza.
//   - fetchConPlaywrightFallback: curl primero, y si Cloudflare bloquea, cae a
//     un browser real con stealth (+ proxy opcional). Es lo que usa el
//     servidor (endpoint on-demand y refresh automático, ver
//     src/jobs/refreshWorker.js), que corre en una IP de datacenter.
//
// OJO: el fetch nativo de Node tiene un fingerprint TLS distinto al de curl,
// y Cloudflare lo bloquea (403) aunque sea la misma IP y los mismos headers
// que un curl que sí pasa. Por eso todo esto usa el binario curl real.

const { execFile } = require('child_process');
// Playwright se carga recién cuando hace falta un browser: el worker remoto
// (teléfono con Termux, PC) solo usa curl y no necesita tenerlo instalado.
let chromiumStealth = null;
function getChromium() {
  if (!chromiumStealth) {
    const { chromium } = require('playwright-extra');
    chromium.use(require('puppeteer-extra-plugin-stealth')());
    chromiumStealth = chromium;
  }
  return chromiumStealth;
}

const env = require('../config/env');
const { detectarCupon } = require('./cuponParser');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --http1.1 es imprescindible: con HTTP/2 (lo que un curl de Linux/Android
// negocia por defecto) Cloudflare responde 403 "challenge" aunque la IP sea
// residencial; la misma página por HTTP/1.1 llega bien. El curl de Windows
// ya usaba HTTP/1.1 por defecto, por eso desde la PC funcionaba sin esto.
// (Comprobado el 15-11-2026 con scripts/worker-telefono.js --diagnostico.)
// Códigos de salida de curl que significan "no hubo conexión" (sin DNS, no
// conecta, tiempo agotado, TLS o conexión cortada), a diferencia de una
// respuesta de Falabella sin datos (BLOCKED).
const CURL_SIN_RED = { 5: 'no resuelve el proxy', 6: 'no resuelve el dominio', 7: 'no conecta', 28: 'tiempo agotado', 35: 'falla TLS', 52: 'respuesta vacía', 55: 'error al enviar', 56: 'conexión cortada' };

function errorDeCurl(err) {
  const e = new Error(`curl ${err.code}${CURL_SIN_RED[err.code] ? `: ${CURL_SIN_RED[err.code]}` : ''}`);
  e.sinRed = err.code in CURL_SIN_RED;
  return e;
}

function curlUnaVez(url, useProxy, comprimido) {
  const args = [
    '-sL', '--http1.1',
    '-H', `User-Agent: ${USER_AGENT}`,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    '-H', 'Accept-Language: es-CL,es;q=0.9,en;q=0.8',
    '--max-time', '20',
  ];
  if (comprimido) args.push('--compressed');
  if (useProxy && env.proxyUrl) args.push('--proxy', env.proxyUrl);
  args.push(url);

  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(errorDeCurl(err));
      if (!stdout || !stdout.includes('__NEXT_DATA__')) return reject(new Error('BLOCKED'));
      resolve(stdout);
    });
  });
}

// ¿Hay internet en este aparato? Se consulta una dirección neutra (no
// Falabella): cualquier respuesta HTTP sirve. INTERNET_PROBE_URL la cambia.
const PROBE_URL = process.env.INTERNET_PROBE_URL || 'https://www.gstatic.com/generate_204';
function hayInternet() {
  return new Promise(resolve => {
    execFile('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', PROBE_URL],
      (err, stdout) => resolve(!!stdout && stdout.trim() !== '000'));
  });
}

// La página de un producto pesa ~1,3 MB sin comprimir; pedirla comprimida la
// baja varias veces, que en un teléfono es casi todo el tiempo de descarga.
// Pero cambiar las cabeceras puede hacer que Cloudflare rechace el pedido, así
// que es adaptativo: se intenta comprimido y, si eso viene bloqueado pero sin
// comprimir pasa, se deja de comprimir por el resto del proceso.
let compresion = 'probando'; // 'probando' | 'si' | 'no'

async function curlFetch(url, useProxy = false) {
  if (compresion === 'no') return curlUnaVez(url, useProxy, false);
  try {
    const html = await curlUnaVez(url, useProxy, true);
    compresion = 'si';
    return html;
  } catch (e) {
    if (compresion === 'si' || e.message !== 'BLOCKED') throw e;
    // Todavía no se sabe si la compresión es el problema: se prueba sin ella.
    const html = await curlUnaVez(url, useProxy, false);
    compresion = 'no';
    console.log('La descarga comprimida viene bloqueada; se sigue sin comprimir.');
    return html;
  }
}

// Trae una página cualquiera (no de producto) y devuelve su código HTTP y el
// HTML, sin exigir __NEXT_DATA__. La usa la búsqueda de cupones.
function fetchPagina(url, { useProxy = false } = {}) {
  const args = [
    '-sL', '--http1.1', '--compressed',
    '-H', `User-Agent: ${USER_AGENT}`,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    '-H', 'Accept-Language: es-CL,es;q=0.9,en;q=0.8',
    '--max-time', '30',
    '-w', '\n__HTTP__%{http_code}',
  ];
  if (useProxy && env.proxyUrl) args.push('--proxy', env.proxyUrl);
  args.push(url);
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout = '') => {
      if (err) return reject(errorDeCurl(err));
      const m = stdout.match(/\n__HTTP__(\d{3})$/);
      resolve({ http: m ? Number(m[1]) : 0, html: m ? stdout.slice(0, m.index) : stdout });
    });
  });
}

async function fetchDirectoConReintentos(url, intentos = 2) {
  let ultimo = null;
  for (let i = 1; i <= intentos; i++) {
    try {
      return await curlFetch(url);
    } catch (e) { ultimo = e; /* reintenta */ }
    if (i < intentos) await new Promise(res => setTimeout(res, 1500));
  }
  // Sin conexión no es lo mismo que "Falabella no dio datos": se informa tal cual.
  if (ultimo?.sinRed) throw ultimo;
  throw new Error('BLOCKED');
}

// Si curl viene bloqueado varias veces seguidas (IP de datacenter marcada por
// Cloudflare), no tiene sentido seguir probándolo antes de cada producto
// durante un refresh de cientos de SKUs: se salta directo al browser por un rato.
const CURL_FAIL_THRESHOLD = 3;
const CURL_PAUSA_MS = 15 * 60 * 1000;
let curlFallosSeguidos = 0;
let curlPausadoHasta = 0;
function curlEnPausa() { return Date.now() < curlPausadoHasta; }
function curlMarcarFallo() {
  if (++curlFallosSeguidos >= CURL_FAIL_THRESHOLD) {
    curlPausadoHasta = Date.now() + CURL_PAUSA_MS;
    curlFallosSeguidos = 0;
    console.log('curl bloqueado varias veces seguidas: usando solo el browser por 15 min');
  }
}
function curlMarcarExito() { curlFallosSeguidos = 0; }

// ── Playwright (servidor) ──

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

// Un solo browser compartido: durante un refresh masivo se reusa el mismo
// contexto (y sus cookies, incluida la que deja Cloudflare al pasar el
// challenge), en vez de lanzar un Chromium nuevo por producto. Se cierra solo
// tras un rato sin uso para no dejar RAM ocupada en el VPS.
const BROWSER_IDLE_MS = 90 * 1000;
let sesion = null; // { browser, context }
let sesionTimer = null;

async function obtenerSesion() {
  clearTimeout(sesionTimer);
  if (sesion && sesion.browser.isConnected()) return sesion;

  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
    ],
  };
  if (env.chromiumPath) launchOpts.executablePath = env.chromiumPath;
  const proxy = buildProxyConfig(env.proxyUrl);
  if (proxy) launchOpts.proxy = proxy;

  const browser = await getChromium().launch(launchOpts);
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1920, height: 1080 },
    locale: 'es-CL',
    extraHTTPHeaders: { 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' },
  });
  sesion = { browser, context };
  return sesion;
}

async function cerrarSesion() {
  clearTimeout(sesionTimer);
  const s = sesion;
  sesion = null;
  if (s) await s.browser.close().catch(() => {});
}

function programarCierreSesion() {
  clearTimeout(sesionTimer);
  sesionTimer = setTimeout(() => { cerrarSesion(); }, BROWSER_IDLE_MS);
  sesionTimer.unref?.();
}

async function playwrightFetch(url) {
  await playwrightSlot();
  let page = null;
  try {
    const { context } = await obtenerSesion();
    page = await context.newPage();
    // Probado bloquear imagenes/fuentes para ahorrar proxy: rompe el challenge de
    // Cloudflare (vuelve a servir 403 "Un momento..."). No tocar resourceType.
    // No se espera a "networkidle": con analytics/chat la red de Falabella casi
    // nunca queda quieta y se perdían 25 s por página. Lo único que importa es
    // que aparezca __NEXT_DATA__ con el documento ya parseado, sea en la
    // primera carga o después de que el challenge de Cloudflare recargue sola.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(e => {
      if (!/timeout/i.test(e.message)) throw e;
    });
    await page.waitForFunction(
      () => document.readyState !== 'loading' && document.getElementById('__NEXT_DATA__') !== null,
      undefined, // arg de la función; las opciones van en el tercer parámetro
      { timeout: 15000 }
    ).catch(() => {});
    const html = await page.content();
    if (!html.includes('__NEXT_DATA__')) throw new Error('BLOCKED');
    await page.close().catch(() => {});
    programarCierreSesion();
    return html;
  } catch (e) {
    // Sesión fallida = se descarta entera: el próximo intento parte con un
    // browser limpio (y, si hay proxy rotativo, con otra IP).
    await cerrarSesion();
    throw e;
  } finally {
    playwrightRelease();
  }
}

// Reintentos de Playwright: el proxy rota de IP en cada conexión nueva,
// así que una IP marcada por Cloudflare en un intento no se repite en los siguientes.
const PLAYWRIGHT_RETRIES = env.proxyUrl ? 5 : 1;

async function fetchConPlaywrightFallback(url) {
  try {
    if (curlEnPausa()) throw new Error('BLOCKED');
    const html = await curlFetch(url, true);
    curlMarcarExito();
    return html;
  } catch (e) {
    if (e.message !== 'BLOCKED' && !e.message.includes('403')) throw e;
    if (!curlEnPausa()) curlMarcarFallo();
    if (playwrightIsBlocked()) throw new Error('BLOCKED');

    for (let attempt = 1; attempt <= PLAYWRIGHT_RETRIES; attempt++) {
      console.log(`curl bloqueado para ${url}, usando playwright (intento ${attempt}/${PLAYWRIGHT_RETRIES})...`);
      try {
        const html = await playwrightFetch(url);
        playwrightMarkSuccess();
        return html;
      } catch (pe) {
        // BLOCKED = la página cargó pero sin datos (challenge). Cualquier otro
        // mensaje es un problema del browser mismo y conviene verlo en el log.
        if (pe.message !== 'BLOCKED') console.log(`playwright falló: ${String(pe.message).split('\n')[0]}`);
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

// Cupón de descuento anunciado en la ficha. Se busca en la variante elegida y
// en el producto sin sus otras variantes (para no tomar el cupón de otro color).
function extraerCupon(pd, variante) {
  try {
    const { variants, ...productoSinVariantes } = pd || {};
    return detectarCupon(variante, productoSinVariantes);
  } catch {
    return null;
  }
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
    cupon: extraerCupon(pd, variante),
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
    cupon: extraerCupon(item, null),
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
  return `${env.falabellaBaseUrl}/falabella-cl/search?Ntt=${sku}`;
}
function urlDirecta(sku) {
  return `${env.falabellaBaseUrl}/falabella-cl/product/${sku}/x/${sku}`;
}
function urlDirectaOffset(sku) {
  const productId = String(Number(sku) - 1);
  return `${env.falabellaBaseUrl}/falabella-cl/product/${productId}/x/${sku}`;
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
//
// Orden adaptativo: si la búsqueda falla varias veces seguidas mientras la
// página directa sí responde (Cloudflare suele tratar distinto a /search), se
// prueba primero la directa por un rato. No se pierde cobertura, solo cambia
// el orden; así no se gastan dos intentos fallidos por cada producto.
const BUSQUEDA_FALLOS_PARA_INVERTIR = 4;
const BUSQUEDA_PAUSA_MS = 30 * 60 * 1000;
let busquedaFallosSeguidos = 0;
let directaPrimeroHasta = 0;

async function intentarBusqueda(sku, fetchFn) {
  try {
    const producto = extraerDeHTML(await fetchFn(urlBusqueda(sku)), sku);
    if (producto) { busquedaFallosSeguidos = 0; return producto; }
  } catch (e) {
    if (e.sinRed) throw e; // sin internet: que decida quien llama
  }
  return null;
}

async function intentarDirecta(sku, fetchFn) {
  try {
    return extraerDeHTML(await fetchFn(urlDirecta(sku)), sku);
  } catch (e) {
    if (e.sinRed) throw e;
    return null;
  }
}

async function scrapeProducto(sku, fetchFn) {
  if (Date.now() < directaPrimeroHasta) {
    const directa = await intentarDirecta(sku, fetchFn);
    if (directa) return { producto: directa, viaDirecta: true };
    const busqueda = await intentarBusqueda(sku, fetchFn);
    if (busqueda) return { producto: busqueda, viaDirecta: false };
  } else {
    const busqueda = await intentarBusqueda(sku, fetchFn);
    if (busqueda) return { producto: busqueda, viaDirecta: false };
    const directa = await intentarDirecta(sku, fetchFn);
    if (directa) {
      // La búsqueda falló pero el producto existe: es la búsqueda la que no anda.
      if (++busquedaFallosSeguidos >= BUSQUEDA_FALLOS_PARA_INVERTIR) {
        directaPrimeroHasta = Date.now() + BUSQUEDA_PAUSA_MS;
        busquedaFallosSeguidos = 0;
        console.log('La búsqueda de Falabella no responde; se usa primero la página directa por 30 min.');
      }
      return { producto: directa, viaDirecta: true };
    }
  }

  if (pareceMarketplaceLargo(sku)) {
    try {
      const html = await fetchFn(urlDirectaOffset(sku));
      const producto = extraerDirectoSinValidarId(html, sku);
      if (producto) return { producto, viaDirecta: true };
    } catch (e) {
      if (e.sinRed) throw e;
    }
  }

  return { producto: null, viaDirecta: false };
}

// ── Stock en tienda ──

const STORE_ID  = '2617'; // Los Dominicos
const STORE_LAT = '-33.394';
const STORE_LON = '-70.551';

async function fetchStockEnVivo(sku) {
  const url = `${env.falabellaBaseUrl}/s/geo/v1/stores/cl?offeringId=${sku}&sellerId=FALABELLA_CHILE&latitude=${STORE_LAT}&longitude=${STORE_LON}`;
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

// ── Diagnóstico ──
// Prueba cada camino hacia Falabella por separado y cuenta qué pasó, para
// distinguir "Cloudflare bloquea esta IP" de "el browser no arranca" sin
// tener que leer los logs del servidor. Lo expone GET /api/diagnostico.

function curlCrudo(url, { proxy = false, accept = 'text/html', extra = [], ua = USER_AGENT } = {}) {
  const args = [
    '-sSL', '-o', '-', '-D', '-',
    '-H', `User-Agent: ${ua}`,
    '-H', `Accept: ${accept}`,
    '-H', 'Accept-Language: es-CL,es;q=0.9,en;q=0.8',
    '--max-time', '20',
    '-w', '\n__CURL__ %{http_code} %{remote_ip} %{time_total}',
  ];
  if (proxy && env.proxyUrl) args.push('--proxy', env.proxyUrl);
  args.push(...extra, url);
  return new Promise(resolve => {
    execFile('curl', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout = '', stderr = '') => {
      const m = stdout.match(/\n__CURL__ (\d+) (\S*) (\S+)$/);
      const cuerpo = m ? stdout.slice(0, m.index) : stdout;
      const cabecera = n => (cuerpo.match(new RegExp(`^${n}:\\s*(.+)$`, 'im')) || [])[1]?.trim() || null;
      resolve({
        // Lo útil es el mensaje de curl (stderr) y su código de salida, no el comando.
        error: err ? `curl ${err.code ?? '?'}: ${String(stderr).trim().split('\n').pop().slice(0, 160)}` : null,
        cuerpo,
        http: m ? Number(m[1]) : null,
        segundos: m ? Number(m[3]) : null,
        bytes: cuerpo.length,
        conDatos: cuerpo.includes('__NEXT_DATA__'),
        titulo: (cuerpo.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim().slice(0, 120) || null,
        server: cabecera('server'),
        cfMitigated: cabecera('cf-mitigated'),
        cfRay: cabecera('cf-ray'),
        muestra: cuerpo.includes('__NEXT_DATA__') ? null : cuerpo.replace(/\s+/g, ' ').slice(-300),
      });
    });
  });
}

async function diagnosticoBrowser(url) {
  const t = Date.now();
  const r = { arranco: false, http: null, urlFinal: null, titulo: null, conDatos: false, error: null, segundos: null };
  await playwrightSlot();
  let page = null;
  try {
    await cerrarSesion(); // sesión limpia: que no influyan cookies de antes
    const { context } = await obtenerSesion();
    r.arranco = true;
    page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    r.http = resp ? resp.status() : null;
    await page.waitForFunction(
      () => document.readyState !== 'loading' && document.getElementById('__NEXT_DATA__') !== null,
      undefined,
      { timeout: 20000 }
    ).catch(() => {});
    r.urlFinal = page.url();
    r.titulo = (await page.title().catch(() => '')).slice(0, 120);
    const html = await page.content();
    r.conDatos = html.includes('__NEXT_DATA__');
    if (!r.conDatos) r.muestra = (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  } catch (e) {
    r.error = String(e.message).split('\n')[0].slice(0, 300);
  } finally {
    await cerrarSesion();
    playwrightRelease();
    r.segundos = Math.round((Date.now() - t) / 100) / 10;
  }
  return r;
}

async function diagnostico(sku) {
  const pagina = urlDirecta(sku);
  const [ipSalida, curlDirecto, curlBusqueda, stock] = await Promise.all([
    curlCrudo('https://api.ipify.org').then(x => (x.http === 200 ? x.muestra?.trim().split(' ').pop() : null) || x.error),
    curlCrudo(pagina, { extra: ['--http1.1'] }),
    curlCrudo(urlBusqueda(sku), { extra: ['--http1.1'] }),
    curlCrudo(`${env.falabellaBaseUrl}/s/geo/v1/stores/cl?offeringId=${sku}&sellerId=FALABELLA_CHILE&latitude=${STORE_LAT}&longitude=${STORE_LON}`, { accept: 'application/json' }),
  ]);
  const curlConProxy = env.proxyUrl ? await curlCrudo(pagina, { proxy: true, extra: ['--http1.1'] }) : null;
  const browser = await diagnosticoBrowser(pagina);

  let conclusion;
  if (curlDirecto.conDatos || curlBusqueda.conDatos) conclusion = 'OK: el servidor lee Falabella directo con curl.';
  else if (curlConProxy?.conDatos) conclusion = 'OK: el servidor lee Falabella a través del proxy.';
  else if (browser.conDatos) conclusion = 'OK: curl está bloqueado pero el browser pasa el challenge.';
  else if (!browser.arranco || (browser.error && browser.http == null)) conclusion = 'PROBLEMA DEL BROWSER: Chromium no arrancó o no pudo navegar (ver browser.error). No es necesariamente un bloqueo.';
  else conclusion = `BLOQUEADO: Falabella/Cloudflare rechaza a esta IP tanto por curl (HTTP ${curlDirecto.http}) como por browser (HTTP ${browser.http}).${env.proxyUrl ? ' El proxy configurado tampoco pasa.' : ' Hace falta un proxy residencial (PROXY_URL).'}`;

  for (const r of [curlDirecto, curlBusqueda, curlConProxy, stock]) if (r) delete r.cuerpo;
  return { conclusion, sku, ipSalida, proxyConfigurado: !!env.proxyUrl, curlDirecto, curlBusqueda, curlConProxy, browser, stock };
}

// Diagnóstico solo-curl, para correr en el worker remoto (teléfono). Prueba la
// misma página con distintas variantes de curl para ver si alguna pasa, y si
// llegan datos comprueba que todavía se puedan interpretar. Devuelve líneas
// cortas pensadas para leerse en la pantalla de un teléfono.
const UA_MOVIL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

async function diagnosticoCurl(sku) {
  const pagina = urlDirecta(sku);
  const pruebas = [
    ['pagina http1.1 (como el worker)', pagina, { extra: ['--http1.1'] }],
    ['busqueda http1.1',        urlBusqueda(sku), { extra: ['--http1.1'] }],
    ['pagina http2',            pagina, { extra: ['--http2'] }],
    ['pagina http2 UA movil',   pagina, { ua: UA_MOVIL, extra: ['--http2', '--compressed'] }],
    ['stock (API)',             `${env.falabellaBaseUrl}/s/geo/v1/stores/cl?offeringId=${sku}&sellerId=FALABELLA_CHILE&latitude=${STORE_LAT}&longitude=${STORE_LON}`, { accept: 'application/json' }],
    ['portada',                 `${env.falabellaBaseUrl}/falabella-cl`, { extra: ['--compressed'] }],
  ];
  const lineas = [];
  for (const [nombre, url, opts] of pruebas) {
    const r = await curlCrudo(url, opts);
    let linea = `${nombre}: HTTP ${r.http ?? '-'} · ${r.bytes} bytes · datos=${r.conDatos ? 'SI' : 'no'}`;
    if (r.cfMitigated) linea += ` · cf=${r.cfMitigated}`;
    if (r.server) linea += ` · ${r.server}`;
    if (r.error) linea += `\n   error: ${r.error}`;
    if (r.titulo) linea += `\n   titulo: ${r.titulo}`;
    if (r.conDatos) {
      // Llegaron datos: ¿todavía se entienden?
      const producto = extraerDeHTML(r.cuerpo, sku) || extraerDirectoSinValidarId(r.cuerpo, sku);
      let claves = '?';
      try {
        const m = r.cuerpo.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        claves = m ? Object.keys(JSON.parse(m[1])?.props?.pageProps || {}).slice(0, 8).join(',') : 'script con otro formato';
      } catch (e) { claves = `JSON invalido (${e.message.slice(0, 40)})`; }
      linea += producto
        ? `\n   producto: ${producto.nombre} $${producto.precioOferta || producto.precio}`
        : `\n   NO se pudo interpretar · pageProps: ${claves}`;
    } else if (nombre.startsWith('stock')) {
      linea += `\n   ${r.cuerpo.replace(/\s+/g, ' ').slice(-120)}`;
    }
    lineas.push(linea);
  }
  return lineas;
}

// Diagnóstico: muestra dónde aparece la palabra "cupón" en la ficha de un
// producto y qué otros datos hay al lado, para saber si Falabella publica el
// monto o el código en algún campo que todavía no se lee.
async function contextoCupon(sku, fetchFn = fetchDirectoConReintentos) {
  const html = await fetchFn(urlDirecta(sku));
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return ['La página no trae datos internos.'];
  const pd = JSON.parse(m[1])?.props?.pageProps?.productData;
  if (!pd) return ['La página no trae los datos del producto.'];

  const corto = v => {
    if (v == null) return String(v);
    if (typeof v === 'object') return Array.isArray(v) ? `[lista de ${v.length}]` : `{${Object.keys(v).slice(0, 6).join(', ')}}`;
    return String(v).replace(/\s+/g, ' ').slice(0, 90);
  };
  const hallazgos = [];
  (function visitar(nodo, ruta, padre, rutaPadre, prof) {
    if (nodo == null || prof > 14 || hallazgos.length >= 4) return;
    if (typeof nodo === 'string') {
      if (/cup[oó]n|coupon/i.test(nodo) && nodo.length < 400) hallazgos.push({ ruta, padre, rutaPadre });
      return;
    }
    if (typeof nodo !== 'object') return;
    for (const [k, v] of Object.entries(nodo)) {
      const r = Array.isArray(nodo) ? `${ruta}[${k}]` : (ruta ? `${ruta}.${k}` : k);
      if (/coupon|cup[oó]n/i.test(k) && v != null && v !== '' && hallazgos.length < 4) hallazgos.push({ ruta: r, padre: nodo, rutaPadre: ruta, porClave: true });
      visitar(v, r, nodo, ruta, prof + 1);
    }
  })(pd, '', null, '', 0);

  if (!hallazgos.length) return [`${pd.name}: la ficha no menciona cupones.`];
  const lineas = [`${pd.name}`];
  const vistos = new Set();
  for (const h of hallazgos) {
    // Dos menciones en el mismo objeto (p. ej. label y type) se muestran una vez.
    if (vistos.has(h.padre)) continue;
    vistos.add(h.padre);
    lineas.push('', `en: ${h.ruta}`);
    const obj = h.padre && typeof h.padre === 'object' && !Array.isArray(h.padre) ? h.padre : null;
    if (obj) for (const [k, v] of Object.entries(obj).slice(0, 14)) lineas.push(`  ${k}: ${corto(v)}`);
  }
  return lineas;
}

module.exports = {
  contextoCupon,
  fetchPagina,
  hayInternet,
  diagnostico,
  diagnosticoCurl,
  fetchDirectoConReintentos,
  fetchConPlaywrightFallback,
  scrapeProducto,
  fetchStockEnVivo,
  parsePrecio,
  playwrightIsBlocked,
  cerrarSesion,
};
