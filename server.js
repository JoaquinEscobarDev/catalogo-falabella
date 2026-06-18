const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'skus.json');

// ── Base de datos JSON simple ──
function leerDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}
function guardarDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Listar todos los SKUs guardados
app.get('/api/skus', (req, res) => {
  res.json(leerDB());
});

// Agregar un SKU
app.post('/api/skus', (req, res) => {
  const { sku, alias, categoria } = req.body;
  if (!sku) return res.status(400).json({ error: 'SKU requerido' });
  const lista = leerDB();
  if (lista.find(s => s.sku === sku.trim())) {
    return res.status(409).json({ error: 'El SKU ya existe' });
  }
  lista.unshift({ sku: sku.trim(), alias: alias || null, categoria: categoria || 'Sin categoría', created_at: new Date().toISOString() });
  guardarDB(lista);
  res.json({ ok: true });
});

// Eliminar un SKU
app.delete('/api/skus/:sku', (req, res) => {
  const lista = leerDB().filter(s => s.sku !== req.params.sku);
  guardarDB(lista);
  res.json({ ok: true });
});

// ── Estrategia de fetch: curl primero (rápido), playwright como fallback ──
function curlFetch(url) {
  return new Promise((resolve, reject) => {
    execFile('curl', [
      '-sL',
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      '-H', 'Accept-Language: es-CL,es;q=0.9,en;q=0.8',
      '--max-time', '15',
      url,
    ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.message));
      if (!stdout || !stdout.includes('__NEXT_DATA__')) return reject(new Error('BLOCKED'));
      resolve(stdout);
    });
  });
}

async function playwrightFetch(url) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

async function fetchFalabella(sku) {
  const url = `https://www.falabella.com/falabella-cl/search?Ntt=${sku}`;
  try {
    return await curlFetch(url);
  } catch (e) {
    if (e.message === 'BLOCKED' || e.message.includes('403')) {
      console.log(`curl bloqueado para ${sku}, usando playwright...`);
      return await playwrightFetch(url);
    }
    throw e;
  }
}

// Obtener producto
app.get('/api/producto/:sku', async (req, res) => {
  const sku = req.params.sku;
  try {
    const html = await fetchFalabella(sku);
    const product = extraerDeHTML(html, sku);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado para ese SKU' });
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function extraerDeHTML(html, skuBuscado) {
  try {
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return null;

    const data = JSON.parse(m[1]);
    const pageProps = data?.props?.pageProps;

    const pd = pageProps?.productData;
    if (pd && (pd.id === skuBuscado || pd.variants?.some(v => v.id === skuBuscado))) {
      return extraerDeProductData(pd, skuBuscado);
    }

    const searchResults = pageProps?.initialData?.state?.results
      || pageProps?.searchResult?.state?.results
      || pageProps?.results;

    if (searchResults) {
      for (const item of searchResults) {
        if (item.id === skuBuscado || item.skus?.some(s => s.skuId === skuBuscado)) {
          return extraerDeSearchResult(item, skuBuscado);
        }
      }
      if (searchResults[0]) return extraerDeSearchResult(searchResults[0], skuBuscado);
    }

    return null;
  } catch (e) {
    console.error('Error parseando HTML:', e.message);
    return null;
  }
}

function extraerDeProductData(pd, skuBuscado) {
  const variante = pd.variants?.find(v => v.id === skuBuscado) || pd.variants?.[0] || {};
  const precios = variante.prices || [];
  const normal = precios.find(p => p.type === 'normalPrice');
  const oferta = precios.find(p => p.type === 'internetPrice' || p.type === 'offerPrice');
  const cmr = precios.find(p => p.type === 'cmrPrice');
  const precioNormal = parsePrecio(normal?.price?.[0]);
  const precioOferta = parsePrecio(oferta?.price?.[0]) || parsePrecio(cmr?.price?.[0]);
  const imagenes = (variante.medias || []).filter(m => m.mediaType === 'image');
  const imagen = imagenes[0]?.url ? `${imagenes[0].url}?width=500&height=500&fit=inside` : null;

  return {
    nombre: pd.name,
    sku: variante.id || skuBuscado,
    marca: pd.brandName,
    precio: precioNormal,
    precioOferta: precioOferta !== precioNormal ? precioOferta : null,
    imagen,
    url: pd.slug ? `https://www.falabella.com/falabella-cl/product/${pd.id}/${pd.slug}` : null,
  };
}

function extraerDeSearchResult(item, skuBuscado) {
  const precios = item.prices || [];
  const normal = precios.find(p => p.type === 'normalPrice');
  const oferta = precios.find(p => p.type === 'internetPrice' || p.type === 'offerPrice' || p.type === 'cmrPrice');
  return {
    nombre: item.displayName || item.name,
    sku: item.id || skuBuscado,
    marca: item.brand,
    precio: parsePrecio(normal?.price?.[0]) || parsePrecio(item.prices?.[0]?.price?.[0]),
    precioOferta: parsePrecio(oferta?.price?.[0]),
    imagen: item.mediaUrl || item.image || null,
    url: item.url ? `https://www.falabella.com${item.url}` : null,
  };
}

function parsePrecio(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? null : n;
}

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
