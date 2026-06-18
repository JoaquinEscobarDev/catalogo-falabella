require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const app = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════
// BASE DE DATOS — PostgreSQL o JSON fallback
// ══════════════════════════════════════════

let db; // cliente pg o null

async function initDB() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.query(`
      CREATE TABLE IF NOT EXISTS skus (
        sku       TEXT PRIMARY KEY,
        alias     TEXT,
        categoria TEXT NOT NULL DEFAULT 'Sin categoría',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS producto_cache (
        sku         TEXT PRIMARY KEY,
        nombre      TEXT,
        marca       TEXT,
        precio      INTEGER,
        precio_oferta INTEGER,
        precio_cmr  INTEGER,
        imagen      TEXT,
        url         TEXT,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('Conectado a PostgreSQL');
  } else {
    console.log('Sin DATABASE_URL — usando archivo JSON local');
  }
}

// ── JSON fallback (local) ──
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'skus.json');
function leerJSON() {
  if (!fs.existsSync(DB_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}
function guardarJSON(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── Caché de productos (local JSON) ──
const CACHE_FILE = process.env.CACHE_PATH || path.join(__dirname, 'productos-cache.json');
function leerCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}
function guardarCache(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── Caché de productos — DB ──
async function dbGetProductoCache(sku) {
  if (db) {
    const r = await db.query('SELECT * FROM producto_cache WHERE sku = $1', [sku]);
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return {
      nombre: row.nombre, sku: row.sku, marca: row.marca,
      precio: row.precio, precioOferta: row.precio_oferta, precioCMR: row.precio_cmr,
      imagen: row.imagen, url: row.url,
      cached: true, updatedAt: row.updated_at,
    };
  }
  const c = leerCache();
  return c[sku] || null;
}

async function dbSetProductoCache(sku, product) {
  if (db) {
    await db.query(`
      INSERT INTO producto_cache (sku, nombre, marca, precio, precio_oferta, precio_cmr, imagen, url, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (sku) DO UPDATE SET
        nombre=EXCLUDED.nombre, marca=EXCLUDED.marca,
        precio=EXCLUDED.precio, precio_oferta=EXCLUDED.precio_oferta,
        precio_cmr=EXCLUDED.precio_cmr, imagen=EXCLUDED.imagen,
        url=EXCLUDED.url, updated_at=NOW()
    `, [sku, product.nombre, product.marca, product.precio,
        product.precioOferta, product.precioCMR, product.imagen, product.url]);
  } else {
    const c = leerCache();
    c[sku] = { ...product, cached: false, updatedAt: new Date().toISOString() };
    guardarCache(c);
  }
}

// ── Operaciones unificadas ──
async function dbGetAll() {
  if (db) {
    const r = await db.query('SELECT * FROM skus ORDER BY created_at DESC');
    return r.rows;
  }
  return leerJSON();
}

async function dbInsert(sku, alias, categoria) {
  if (db) {
    await db.query(
      'INSERT INTO skus (sku, alias, categoria) VALUES ($1, $2, $3)',
      [sku, alias || null, categoria || 'Sin categoría']
    );
  } else {
    const lista = leerJSON();
    lista.unshift({ sku, alias: alias || null, categoria: categoria || 'Sin categoría', created_at: new Date().toISOString() });
    guardarJSON(lista);
  }
}

async function dbDelete(sku) {
  if (db) {
    await db.query('DELETE FROM skus WHERE sku = $1', [sku]);
  } else {
    guardarJSON(leerJSON().filter(s => s.sku !== sku));
  }
}

async function dbExists(sku) {
  if (db) {
    const r = await db.query('SELECT 1 FROM skus WHERE sku = $1', [sku]);
    return r.rowCount > 0;
  }
  return leerJSON().some(s => s.sku === sku);
}

// ══════════════════════════════════════════
// RUTAS API
// ══════════════════════════════════════════

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/skus', async (req, res) => {
  try { res.json(await dbGetAll()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/skus', async (req, res) => {
  const { sku, alias, categoria } = req.body;
  if (!sku) return res.status(400).json({ error: 'SKU requerido' });
  try {
    if (await dbExists(sku.trim())) return res.status(409).json({ error: 'El SKU ya existe' });
    await dbInsert(sku.trim(), alias, categoria);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/skus/:sku', async (req, res) => {
  try { await dbDelete(req.params.sku); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════
// SCRAPING FALABELLA
// ══════════════════════════════════════════

// Limita Playwright a un browser a la vez para no explotar RAM en Railway
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

// Circuit breaker: si Playwright falla, pausa 10 min antes de reintentar
let playwrightBlocked = false;
let playwrightBlockedUntil = 0;
function playwrightIsBlocked() {
  if (!playwrightBlocked) return false;
  if (Date.now() > playwrightBlockedUntil) { playwrightBlocked = false; return false; }
  return true;
}
function playwrightMarkBlocked() {
  playwrightBlocked = true;
  playwrightBlockedUntil = Date.now() + 10 * 60 * 1000;
  console.log('Playwright bloqueado 10 min, usando caché');
}

function curlFetch(url) {
  const args = [
    '-sL',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    '-H', 'Accept-Language: es-CL,es;q=0.9,en;q=0.8',
    '--max-time', '20',
  ];
  if (process.env.PROXY_URL) args.push('--proxy', process.env.PROXY_URL);
  args.push(url);

  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.message));
      if (!stdout || !stdout.includes('__NEXT_DATA__')) return reject(new Error('BLOCKED'));
      resolve(stdout);
    });
  });
}

async function playwrightFetch(url) {
  await playwrightSlot();
  const proxyServer = process.env.PROXY_URL;
  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
    ],
  };
  if (proxyServer) launchOpts.proxy = { server: proxyServer };

  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'es-CL',
      extraHTTPHeaders: { 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' },
    });
    const page = await context.newPage();
    // Esperar que la red quede idle para que el JS challenge de Cloudflare se resuelva
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

async function fetchFalabella(sku) {
  const url = `https://www.falabella.com/falabella-cl/search?Ntt=${sku}`;
  try {
    // Con proxy residencial, curl es suficiente y mucho más rápido
    return await curlFetch(url);
  } catch (e) {
    if (e.message !== 'BLOCKED' && !e.message.includes('403')) throw e;
    // Sin proxy: intentar Playwright como fallback
    if (process.env.PROXY_URL) throw new Error('BLOCKED'); // proxy falló, no reintentar
    if (playwrightIsBlocked()) throw new Error('BLOCKED');
    console.log(`curl bloqueado para ${sku}, usando playwright...`);
    try {
      return await playwrightFetch(url);
    } catch (pe) {
      playwrightMarkBlocked();
      throw new Error('BLOCKED');
    }
  }
}

app.get('/api/producto/:sku', async (req, res) => {
  const sku = req.params.sku;
  try {
    let product = null;
    try {
      const html = await fetchFalabella(sku);
      product = extraerDeHTML(html, sku);
    } catch (e) {
      console.log(`Scraping falló para ${sku}: ${e.message}`);
    }

    if (product) {
      // Guardar/actualizar caché en background (no bloquea la respuesta)
      dbSetProductoCache(sku, product).catch(() => {});
      return res.json(product);
    }

    // Fallback: datos del caché
    const cached = await dbGetProductoCache(sku);
    if (cached) return res.json(cached);

    res.status(404).json({ error: 'Producto no encontrado para ese SKU' });
  } catch (e) {
    // Último recurso: intentar caché ante cualquier error inesperado
    try {
      const cached = await dbGetProductoCache(sku);
      if (cached) return res.json(cached);
    } catch {}
    res.status(500).json({ error: e.message });
  }
});

// Stock en tienda Los Dominicos (ID: 2617)
const STORE_ID   = '2617';
const STORE_LAT  = '-33.394';
const STORE_LON  = '-70.551';

app.get('/api/stock/:sku', async (req, res) => {
  const sku = req.params.sku;
  try {
    const url = `https://www.falabella.com/s/geo/v1/stores/cl?offeringId=${sku}&sellerId=FALABELLA_CHILE&latitude=${STORE_LAT}&longitude=${STORE_LON}`;
    const { execFile } = require('child_process');
    const html = await new Promise((resolve, reject) => {
      execFile('curl', [
        '-s', url,
        '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        '-H', 'Accept: application/json',
        '-H', 'Referer: https://www.falabella.com/',
        '--max-time', '10',
      ], { maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
    const data   = JSON.parse(html);
    const stores = data?.stores || [];
    const tienda = stores.find(s => s.id === STORE_ID);
    if (!tienda) return res.json({ stock: null, storeName: 'Los Dominicos' });
    res.json({ stock: tienda.stockQuantity?.number ?? null, storeName: tienda.storeName });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════
// PARSING HTML
// ══════════════════════════════════════════

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
        if (item.id === skuBuscado || item.skus?.some(s => s.skuId === skuBuscado)) return extraerDeSearchResult(item, skuBuscado);
      }
      if (results[0]) return extraerDeSearchResult(results[0], skuBuscado);
    }
    return null;
  } catch (e) {
    console.error('Error parseando HTML:', e.message);
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
  return {
    nombre: item.displayName || item.name, sku: item.id || skuBuscado, marca: item.brand,
    precio: precioN,
    precioOferta: precioO && precioO !== precioN ? precioO : null,
    precioCMR: precioCMR && precioCMR !== precioN && precioCMR !== precioO ? precioCMR : null,
    imagen: item.mediaUrl || item.image || null,
    url: item.url ? `https://www.falabella.com${item.url}` : null,
  };
}

function parsePrecio(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? null : n;
}

// ══════════════════════════════════════════
// INICIO
// ══════════════════════════════════════════

initDB().then(() => {
  app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
}).catch(e => {
  console.error('Error iniciando DB:', e.message);
  process.exit(1);
});
