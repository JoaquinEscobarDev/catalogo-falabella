// Lógica compartida de scraping para correr en una IP residencial (sin proxy).
// Usado por refresh-local.js (corrida diaria completa) y watch-refresh.js
// (atiende solicitudes puntuales desde el botón "Actualizar precios").

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
    // Cuando el producto no tiene variantes de color/tamaño (un solo SKU),
    // Falabella no llena attributes.size/colorName — ahí se sacan del
    // nombre interno de la variante (ej. "SAMSUNG GALAXY A17 128GB NEGRO").
    capacidad: extraerCapacidad(pd.name, variante.attributes) || extraerCapacidad(variante.name, null),
    color: variante.attributes?.colorName || extraerColorDeNombre(variante.name),
    ...extraerGarantias(pd),
  };
}

// El nombre del producto (pd.name) es genérico y no trae GB ni color —
// esos datos están solo en attributes.size de la variante elegida. En
// resultados de búsqueda no hay attributes, ahí se sacan del nombre.
function extraerCapacidad(nombre, attributes) {
  if (attributes?.size) return attributes.size;
  const m = (nombre || '').match(/(\d+\s?(?:GB|TB))/i);
  return m ? m[1].replace(/\s+/g, ' ').toUpperCase() : null;
}

// Igual que la capacidad: en resultados de búsqueda no hay attributes,
// pero el nombre suele terminar con el color (ej. "...256GB Negro").
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

function extraerDeSearchResult(item, skuBuscado) {
  const precios = item.prices || [];
  const normal  = precios.find(p => p.type === 'normalPrice');
  const oferta  = precios.find(p => p.type === 'internetPrice' || p.type === 'offerPrice');
  const cmr     = precios.find(p => p.type === 'cmrPrice');
  const precioN = parsePrecio(normal?.price?.[0]) || parsePrecio(item.prices?.[0]?.price?.[0]);
  const precioO = parsePrecio(oferta?.price?.[0]);
  const precioCMR = parsePrecio(cmr?.price?.[0]);
  const imagen = item.mediaUrl || item.image || item.mediaUrls?.[0] || null;
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
    // Los listados de búsqueda no traen warrantyOptions, solo la página de producto.
    garantia1a: null, garantia2a: null, garantia3a: null,
  };
}

function parsePrecio(str) {
  if (!str) return null;
  const n = parseInt(String(str).replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? null : n;
}

// Busca el producto probando primero la búsqueda y, si no aparece
// (sin stock), la página directa. Devuelve null si no existe.
async function obtenerProducto(sku) {
  let producto = null;
  try {
    const html = await fetchFalabella(sku);
    producto = extraerDeHTML(html, sku);
  } catch { /* sigue al fallback */ }
  if (!producto) {
    const html = await fetchFalabellaDirecto(sku);
    producto = extraerDeHTML(html, sku);
  }
  return producto;
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

// Trae, compara contra el caché y guarda. Devuelve { ok, viaDirecta, cambio }.
async function actualizarSku(db, sku) {
  const html = await (async () => {
    try { return await fetchFalabella(sku); } catch { return null; }
  })();
  let producto = html ? extraerDeHTML(html, sku) : null;
  let viaDirecta = false;
  if (!producto) {
    const htmlDirecto = await fetchFalabellaDirecto(sku);
    producto = extraerDeHTML(htmlDirecto, sku);
    viaDirecta = !!producto;
  }
  if (!producto) return { ok: false };

  const { rows: previos } = await db.query('SELECT precio, precio_oferta, precio_cmr FROM producto_cache WHERE sku = $1', [sku]);
  const previo = previos[0] || null;
  const cambio = previo
    ? (previo.precio !== producto.precio || previo.precio_oferta !== producto.precioOferta || previo.precio_cmr !== producto.precioCMR)
    : false;
  if (cambio) await registrarCambios(db, sku, previo, producto);

  await db.query(`
    INSERT INTO producto_cache (sku, nombre, marca, precio, precio_oferta, precio_cmr, imagen, url, garantia_1a, garantia_2a, garantia_3a, capacidad, color, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
    ON CONFLICT (sku) DO UPDATE SET
      nombre=EXCLUDED.nombre, marca=EXCLUDED.marca,
      precio=EXCLUDED.precio, precio_oferta=EXCLUDED.precio_oferta,
      precio_cmr=EXCLUDED.precio_cmr, imagen=EXCLUDED.imagen,
      url=EXCLUDED.url,
      garantia_1a=EXCLUDED.garantia_1a, garantia_2a=EXCLUDED.garantia_2a, garantia_3a=EXCLUDED.garantia_3a,
      capacidad=EXCLUDED.capacidad, color=EXCLUDED.color,
      updated_at=NOW()
  `, [sku, producto.nombre, producto.marca, producto.precio, producto.precioOferta, producto.precioCMR, producto.imagen, producto.url,
      producto.garantia1a, producto.garantia2a, producto.garantia3a, producto.capacidad, producto.color]);

  return { ok: true, viaDirecta, cambio, producto };
}

async function asegurarTablas(db) {
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS solicitudes_refresh (
      id SERIAL PRIMARY KEY,
      categoria TEXT NOT NULL,
      creado_en TIMESTAMPTZ DEFAULT NOW(),
      procesado BOOLEAN DEFAULT FALSE
    )
  `);
  await db.query(`ALTER TABLE producto_cache ADD COLUMN IF NOT EXISTS garantia_1a INTEGER`);
  await db.query(`ALTER TABLE producto_cache ADD COLUMN IF NOT EXISTS garantia_2a INTEGER`);
  await db.query(`ALTER TABLE producto_cache ADD COLUMN IF NOT EXISTS garantia_3a INTEGER`);
  await db.query(`ALTER TABLE producto_cache ADD COLUMN IF NOT EXISTS capacidad TEXT`);
  await db.query(`ALTER TABLE producto_cache ADD COLUMN IF NOT EXISTS color TEXT`);
}

module.exports = {
  obtenerProducto, actualizarSku, registrarCambios, asegurarTablas,
  fetchFalabella, fetchFalabellaDirecto, extraerDeHTML, extraerGarantias,
  extraerCapacidad, extraerColorDeNombre, parsePrecio,
};
