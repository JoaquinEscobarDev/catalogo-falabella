const db = require('../config/database');

function mapRowToProducto(row) {
  if (!row || row.nombre == null) return null;
  return {
    nombre: row.nombre, sku: row.sku, marca: row.marca,
    precio: row.precio_normal, precioOferta: row.precio_oferta, precioCMR: row.precio_cmr,
    imagen: row.imagen, url: row.url, cached: true, updatedAt: row.price_updated_at,
    garantia1a: row.garantia_1a, garantia2a: row.garantia_2a, garantia3a: row.garantia_3a,
    capacidad: row.capacidad, color: row.color, cuotasSinInteres: row.cuotas_sin_interes,
    despacho24h: row.despacho_24h, upc: row.upc,
    // Cupón crudo detectado al scrapear; couponService lo convierte en
    // `cupones` (con precio final) antes de responder al cliente.
    cuponDetectado: row.cupon || null,
    // Plan Connect detectado en la ficha (compañía, mensual, tipo...).
    plan: row.plan || null,
    // Precio del equipo con plan (colección Falabella Connect), si aparece ahí.
    conPlan: row.oferta_precio ? { precio: row.oferta_precio, tipoPrecio: row.oferta_tipo } : null,
  };
}

// Lista para la vista inicial (Agregar/Buscar SKU) — misma forma que la vieja tabla skus.
async function findAll() {
  const { rows } = await db.query(`
    SELECT p.sku, p.alias, c.nombre AS categoria, p.subcategoria, p.created_at
    FROM products p
    JOIN categories c ON c.id = p.category_id
    ORDER BY p.created_at DESC
  `);
  return rows;
}

async function existsBySku(sku) {
  const r = await db.query('SELECT 1 FROM products WHERE sku = $1', [sku]);
  return r.rowCount > 0;
}

async function insert(sku, alias, categoryId, subcategoria) {
  await db.query(
    'INSERT INTO products (sku, alias, category_id, subcategoria) VALUES ($1, $2, $3, $4)',
    [sku, alias || null, categoryId, subcategoria || null]
  );
}

async function remove(sku) {
  await db.query('DELETE FROM products WHERE sku = $1', [sku]);
}

async function getPriceData(sku) {
  const r = await db.query(`
    SELECT p.*, o.precio_con_plan AS oferta_precio, o.tipo_precio AS oferta_tipo
    FROM products p
    LEFT JOIN connect_ofertas o ON o.id_falabella = p.sku AND o.detectado_en > NOW() - INTERVAL '3 days'
    WHERE p.sku = $1
  `, [sku]);
  return mapRowToProducto(r.rows[0]);
}

async function getCategoryName(sku) {
  const r = await db.query(
    'SELECT c.nombre FROM products p JOIN categories c ON c.id = p.category_id WHERE p.sku = $1', [sku]
  );
  return r.rows[0]?.nombre || null;
}

// Cupones vistos en la ficha de cada producto. Solo de productos actualizados
// en los últimos 3 días: si la ficha ya no muestra el cupón, el refresh lo
// borra (products.cupon = NULL) y deja de aparecer.
async function findCuponesEnFichas() {
  const { rows } = await db.query(`
    SELECT p.sku, p.nombre, p.marca, p.cupon, c.nombre AS categoria
    FROM products p JOIN categories c ON c.id = p.category_id
    WHERE p.cupon IS NOT NULL AND p.price_updated_at > NOW() - INTERVAL '3 days'
    ORDER BY p.nombre
  `);
  return rows;
}

// Todos los productos con lo necesario para saber a cuáles aplica un cupón
// y cuánto quedan con él (ventana "productos del cupón").
async function findParaCupones() {
  const { rows } = await db.query(`
    SELECT p.sku, p.nombre, p.marca, p.upc, p.precio_normal, p.precio_oferta, p.precio_cmr, p.cupon,
           (p.price_updated_at > NOW() - INTERVAL '3 days') AS fresco, c.nombre AS categoria
    FROM products p JOIN categories c ON c.id = p.category_id
    ORDER BY p.nombre NULLS LAST, p.sku
  `);
  return rows;
}

// Cuántos productos hay por marca y por categoría, para decir a cuántos
// productos aplica cada cupón.
async function contarProductos() {
  const [marcas, categorias, total] = await Promise.all([
    db.query(`SELECT UPPER(marca) AS clave, COUNT(*)::int AS n FROM products WHERE marca IS NOT NULL GROUP BY UPPER(marca)`),
    db.query(`SELECT c.nombre AS clave, COUNT(*)::int AS n FROM products p JOIN categories c ON c.id = p.category_id GROUP BY c.nombre`),
    db.query(`SELECT COUNT(*)::int AS n FROM products`),
  ]);
  const aObjeto = rows => Object.fromEntries(rows.map(r => [r.clave, r.n]));
  return { porMarca: aObjeto(marcas.rows), porCategoria: aObjeto(categorias.rows), total: total.rows[0].n };
}

async function findMarcas() {
  const { rows } = await db.query(`SELECT DISTINCT marca FROM products WHERE marca IS NOT NULL AND marca <> ''`);
  return rows.map(r => r.marca);
}

async function findAllSkus() {
  const { rows } = await db.query('SELECT sku FROM products ORDER BY sku');
  return rows.map(r => r.sku);
}

async function findSkusByCategoryName(nombreCategoria) {
  const { rows } = await db.query(
    'SELECT p.sku FROM products p JOIN categories c ON c.id = p.category_id WHERE c.nombre = $1 ORDER BY p.sku',
    [nombreCategoria]
  );
  return rows.map(r => r.sku);
}

// Snapshot de precios actuales, usado para diffear contra un scrape nuevo.
async function getPreviousPrices(sku) {
  const r = await db.query(
    'SELECT precio_normal, precio_oferta, precio_cmr FROM products WHERE sku = $1', [sku]
  );
  return r.rows[0] || null;
}

async function setPriceData(sku, producto) {
  await db.query(`
    UPDATE products SET
      nombre = $2, marca = $3,
      precio_normal = $4, precio_oferta = $5, precio_cmr = $6,
      imagen = $7, url = $8,
      garantia_1a = $9, garantia_2a = $10, garantia_3a = $11,
      capacidad = $12, color = $13,
      cuotas_sin_interes = $14, despacho_24h = $15,
      cupon = $16,
      plan = $17,
      price_updated_at = NOW()
    WHERE sku = $1
  `, [sku, producto.nombre, producto.marca,
      producto.precio, producto.precioOferta, producto.precioCMR, producto.imagen, producto.url,
      producto.garantia1a, producto.garantia2a, producto.garantia3a,
      producto.capacidad, producto.color, producto.cuotasSinInteres, producto.despacho24h,
      producto.cupon ? JSON.stringify(producto.cupon) : null,
      producto.plan ? JSON.stringify(producto.plan) : null]);
}

// Trae precio + stock cacheados de toda una categoría en una sola consulta.
async function setUpc(sku, upc) {
  await db.query('UPDATE products SET upc = $2 WHERE sku = $1', [sku, upc || null]);
}

async function findByCategoryName(nombreCategoria) {
  const { rows } = await db.query(`
    SELECT p.*, st.stock, st.store_name, o.precio_con_plan AS oferta_precio, o.tipo_precio AS oferta_tipo
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock_cache st ON st.sku = p.sku
    LEFT JOIN connect_ofertas o ON o.id_falabella = p.sku AND o.detectado_en > NOW() - INTERVAL '3 days'
    WHERE c.nombre = $1
  `, [nombreCategoria]);

  return rows.map(r => ({
    sku: r.sku,
    alias: r.alias,
    producto: mapRowToProducto(r),
    stock: r.store_name ? { stock: r.stock, storeName: r.store_name } : null,
  }));
}

async function search(q) {
  const term = `%${q}%`;
  const { rows } = await db.query(`
    SELECT p.sku, p.alias, c.nombre AS categoria,
           p.nombre, p.marca, p.imagen,
           p.precio_normal, p.precio_oferta, p.precio_cmr,
           p.url, p.price_updated_at,
           p.garantia_1a, p.garantia_2a, p.garantia_3a,
           p.capacidad, p.color, p.cuotas_sin_interes, p.despacho_24h, p.upc, p.cupon, p.plan, o.precio_con_plan AS oferta_precio, o.tipo_precio AS oferta_tipo,
           s.stock
    FROM products p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock_cache s ON s.sku = p.sku
    LEFT JOIN connect_ofertas o ON o.id_falabella = p.sku AND o.detectado_en > NOW() - INTERVAL '3 days'
    WHERE p.sku ILIKE $1 OR p.alias ILIKE $1
       OR p.nombre ILIKE $1 OR p.marca ILIKE $1
    ORDER BY p.nombre
    LIMIT 60
  `, [term]);
  return rows.map(r => ({
    sku: r.sku, alias: r.alias, categoria: r.categoria,
    nombre: r.nombre, marca: r.marca, imagen: r.imagen,
    precio: r.precio_normal, precioOferta: r.precio_oferta, precioCMR: r.precio_cmr,
    url: r.url, updatedAt: r.price_updated_at, cached: true,
    garantia1a: r.garantia_1a, garantia2a: r.garantia_2a, garantia3a: r.garantia_3a,
    capacidad: r.capacidad, color: r.color,
    cuotasSinInteres: r.cuotas_sin_interes, despacho24h: r.despacho_24h,
    upc: r.upc, cuponDetectado: r.cupon || null, plan: r.plan || null,
    conPlan: r.oferta_precio ? { precio: r.oferta_precio, tipoPrecio: r.oferta_tipo } : null,
    stock: r.stock,
  }));
}

module.exports = {
  findAll, existsBySku, insert, remove,
  getPriceData, getCategoryName, findAllSkus, findMarcas, findCuponesEnFichas, findParaCupones, contarProductos, findSkusByCategoryName, getPreviousPrices, setPriceData, findByCategoryName, search, setUpc,
};
