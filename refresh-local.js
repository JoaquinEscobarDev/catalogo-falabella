// Refresca los precios de todos los SKUs guardados.
// Pensado para correr en tu PC (IP residencial, sin proxy) vía el
// Programador de tareas de Windows — Railway tiene IP de datacenter
// y Cloudflare la bloquea, por eso esto no puede correr ahí.
//
// Uso manual: node refresh-local.js
// Uso programado: ver setup-tarea-programada.md

require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { execFile } = require('child_process');

// OJO: el fetch nativo de Node tiene un fingerprint TLS distinto al de curl,
// y Cloudflare lo bloquea (403) aunque sea la misma IP y los mismos headers
// que un curl que sí pasa. Por eso esto usa el binario curl real, no fetch.
function curlFetch(url) {
  const args = [
    '-sL',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    '-H', 'Accept-Language: es-CL,es;q=0.9,en;q=0.8',
    '--max-time', '20',
    url,
  ];
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.message));
      if (!stdout || !stdout.includes('__NEXT_DATA__')) return reject(new Error('BLOCKED'));
      resolve(stdout);
    });
  });
}

async function fetchUrl(url, intentos = 2) {
  for (let i = 1; i <= intentos; i++) {
    try {
      return await curlFetch(url);
    } catch { /* reintenta */ }
    if (i < intentos) await new Promise(res => setTimeout(res, 1500));
  }
  throw new Error('BLOCKED');
}

// Productos sin stock quedan fuera de la búsqueda (Ntt=) pero la página
// directa del producto los sigue mostrando. El slug en la URL no importa,
// Falabella resuelve por el ID — por eso "x" funciona como slug cualquiera.
async function fetchFalabella(sku) {
  return fetchUrl(`https://www.falabella.com/falabella-cl/search?Ntt=${sku}`);
}

async function fetchFalabellaDirecto(sku) {
  return fetchUrl(`https://www.falabella.com/falabella-cl/product/${sku}/x/${sku}`);
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
        if (item.id === skuBuscado || item.skus?.some(s => s.skuId === skuBuscado)) return extraerDeSearchResult(item, skuBuscado);
      }
      if (results[0]) return extraerDeSearchResult(results[0], skuBuscado);
    }
    return null;
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

async function registrarCambios(db, sku, anterior, nuevo) {
  const campos = [
    ['normal', anterior?.precio, nuevo.precio],
    ['oferta', anterior?.precio_oferta, nuevo.precioOferta],
    ['cmr', anterior?.precio_cmr, nuevo.precioCMR],
  ];
  for (const [campo, antes, despues] of campos) {
    // Solo registrar si ya había un precio previo y cambió (evita ruido en el primer fetch)
    if (antes != null && despues != null && antes !== despues) {
      await db.query(
        'INSERT INTO cambios_precio (sku, campo, precio_anterior, precio_nuevo) VALUES ($1,$2,$3,$4)',
        [sku, campo, antes, despues]
      );
    }
  }
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(`
    CREATE TABLE IF NOT EXISTS cambios_precio (
      id SERIAL PRIMARY KEY,
      sku TEXT NOT NULL,
      campo TEXT NOT NULL,
      precio_anterior INTEGER,
      precio_nuevo INTEGER,
      fecha TIMESTAMPTZ DEFAULT NOW(),
      visto BOOLEAN DEFAULT FALSE
    )
  `);

  const { rows } = await db.query('SELECT sku FROM skus ORDER BY sku');
  console.log(`[${new Date().toLocaleString('es-CL')}] Refrescando ${rows.length} SKUs...`);

  let ok = 0, fail = 0, viaDirecta = 0, cambios = 0;
  for (const { sku } of rows) {
    try {
      let producto = null;
      try {
        const html = await fetchFalabella(sku);
        producto = extraerDeHTML(html, sku);
      } catch { /* sigue al fallback */ }
      if (!producto) {
        // No salió en la búsqueda (probablemente sin stock) — probar la página directa
        const html = await fetchFalabellaDirecto(sku);
        producto = extraerDeHTML(html, sku);
        if (producto) viaDirecta++;
      }
      if (!producto) throw new Error('sin datos');

      const { rows: previos } = await db.query('SELECT precio, precio_oferta, precio_cmr FROM producto_cache WHERE sku = $1', [sku]);
      const previo = previos[0] || null;
      const antesDeCambios = previo
        ? (previo.precio !== producto.precio || previo.precio_oferta !== producto.precioOferta || previo.precio_cmr !== producto.precioCMR)
        : false;
      if (antesDeCambios) {
        await registrarCambios(db, sku, previo, producto);
        cambios++;
      }

      await db.query(`
        INSERT INTO producto_cache (sku, nombre, marca, precio, precio_oferta, precio_cmr, imagen, url, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (sku) DO UPDATE SET
          nombre=EXCLUDED.nombre, marca=EXCLUDED.marca,
          precio=EXCLUDED.precio, precio_oferta=EXCLUDED.precio_oferta,
          precio_cmr=EXCLUDED.precio_cmr, imagen=EXCLUDED.imagen,
          url=EXCLUDED.url, updated_at=NOW()
      `, [sku, producto.nombre, producto.marca, producto.precio, producto.precioOferta, producto.precioCMR, producto.imagen, producto.url]);
      ok++;
      console.log(`  OK   ${sku} - ${producto.nombre} - $${producto.precio || producto.precioOferta || '?'}${antesDeCambios ? ' (precio cambió)' : ''}`);
    } catch (e) {
      fail++;
      console.log(`  FAIL ${sku} - ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 400)); // ritmo prudente, no hay apuro
  }

  console.log(`\n[${new Date().toLocaleString('es-CL')}] Listo: ${ok} OK (${viaDirecta} vía página directa, ${cambios} con cambio de precio) / ${fail} FAIL de ${rows.length}`);
  await db.end();
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
