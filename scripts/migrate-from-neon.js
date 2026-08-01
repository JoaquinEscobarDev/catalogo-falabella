// Migración de una sola vez: copia los datos del Postgres viejo (Neon, usado
// por Railway) al Postgres propio del VPS de Hostinger, adaptando el esquema
// legacy (skus + producto_cache separadas, categoria como texto libre) al
// esquema nuevo normalizado (categories + products fusionadas).
//
// No migra `solicitudes_refresh`: es una cola de trabajo operativa, no datos
// del catálogo — no hay nada que perder si arranca vacía en el server nuevo.
//
// Uso:
//   OLD_DATABASE_URL=postgresql://...neon.tech/neondb \
//   NEW_DATABASE_URL=postgresql://...vps/catalogo_falabella \
//   node scripts/migrate-from-neon.js
//
// Idempotente: correrlo dos veces no duplica filas (usa ON CONFLICT / NOT EXISTS).
// Requiere que `node migrations/run.js` ya se haya corrido contra NEW_DATABASE_URL.

require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
  const oldUrl = process.env.OLD_DATABASE_URL;
  const newUrl = process.env.NEW_DATABASE_URL;
  if (!oldUrl || !newUrl) {
    throw new Error('Definí OLD_DATABASE_URL (Neon) y NEW_DATABASE_URL (Postgres del VPS) en el entorno');
  }

  const oldDb = new Client({ connectionString: oldUrl, ssl: { rejectUnauthorized: false } });
  const newDb = new Client({ connectionString: newUrl });
  await oldDb.connect();
  await newDb.connect();

  const tablaExiste = await newDb.query(`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'products'
  `);
  if (!tablaExiste.rowCount) {
    throw new Error('La tabla products no existe en NEW_DATABASE_URL — corré antes "node migrations/run.js"');
  }

  await newDb.query('BEGIN');
  try {
    const contadores = await migrarCategorias(oldDb, newDb);
    contadores.products = await migrarProductos(oldDb, newDb);
    contadores.priceHistory = await migrarHistorialPrecios(oldDb, newDb);
    contadores.stock = await migrarStock(oldDb, newDb);
    contadores.todo = await migrarTodo(oldDb, newDb);

    await newDb.query('COMMIT');
    console.log('\nMigración completa:');
    console.log(`  categorías:        ${contadores.categorias}`);
    console.log(`  productos:         ${contadores.products}`);
    console.log(`  historial precios: ${contadores.priceHistory}`);
    console.log(`  stock:             ${contadores.stock}`);
    console.log(`  todo:              ${contadores.todo}`);
  } catch (e) {
    await newDb.query('ROLLBACK');
    throw e;
  }

  await oldDb.end();
  await newDb.end();
}

async function migrarCategorias(oldDb, newDb) {
  const { rows } = await oldDb.query(`
    SELECT DISTINCT COALESCE(categoria, 'Sin categoría') AS categoria FROM skus
  `);
  let n = 0;
  for (const { categoria } of rows) {
    const r = await newDb.query(
      'INSERT INTO categories (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING RETURNING id',
      [categoria]
    );
    if (r.rowCount) n++;
  }
  return { categorias: n };
}

async function categoryIdMap(newDb) {
  const { rows } = await newDb.query('SELECT id, nombre FROM categories');
  return new Map(rows.map(r => [r.nombre, r.id]));
}

async function migrarProductos(oldDb, newDb) {
  const { rows } = await oldDb.query(`
    SELECT s.sku, s.alias, COALESCE(s.categoria, 'Sin categoría') AS categoria, s.created_at,
           p.nombre, p.marca, p.precio, p.precio_oferta, p.precio_cmr, p.imagen, p.url,
           p.garantia_1a, p.garantia_2a, p.garantia_3a, p.capacidad, p.color,
           p.cuotas_sin_interes, p.despacho_24h, p.updated_at AS precio_actualizado
    FROM skus s
    LEFT JOIN producto_cache p ON p.sku = s.sku
  `);

  const idPorCategoria = await categoryIdMap(newDb);
  let n = 0;
  for (const r of rows) {
    const categoryId = idPorCategoria.get(r.categoria);
    await newDb.query(`
      INSERT INTO products (
        sku, alias, category_id, nombre, marca,
        precio_normal, precio_oferta, precio_cmr, imagen, url,
        garantia_1a, garantia_2a, garantia_3a, capacidad, color,
        cuotas_sin_interes, despacho_24h, created_at, price_updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (sku) DO UPDATE SET
        alias=EXCLUDED.alias, category_id=EXCLUDED.category_id,
        nombre=EXCLUDED.nombre, marca=EXCLUDED.marca,
        precio_normal=EXCLUDED.precio_normal, precio_oferta=EXCLUDED.precio_oferta, precio_cmr=EXCLUDED.precio_cmr,
        imagen=EXCLUDED.imagen, url=EXCLUDED.url,
        garantia_1a=EXCLUDED.garantia_1a, garantia_2a=EXCLUDED.garantia_2a, garantia_3a=EXCLUDED.garantia_3a,
        capacidad=EXCLUDED.capacidad, color=EXCLUDED.color,
        cuotas_sin_interes=EXCLUDED.cuotas_sin_interes, despacho_24h=EXCLUDED.despacho_24h,
        price_updated_at=EXCLUDED.price_updated_at
    `, [
      r.sku, r.alias, categoryId, r.nombre, r.marca,
      r.precio, r.precio_oferta, r.precio_cmr, r.imagen, r.url,
      r.garantia_1a, r.garantia_2a, r.garantia_3a, r.capacidad, r.color,
      r.cuotas_sin_interes, r.despacho_24h, r.created_at, r.precio_actualizado,
    ]);
    n++;
  }
  return n;
}

async function migrarHistorialPrecios(oldDb, newDb) {
  const { rows } = await oldDb.query(`
    SELECT sku, campo, precio_anterior, precio_nuevo, fecha, visto FROM cambios_precio
    WHERE sku IN (SELECT sku FROM skus)
  `);
  let n = 0;
  for (const r of rows) {
    const existe = await newDb.query(`
      SELECT 1 FROM price_history
      WHERE sku=$1 AND campo=$2 AND precio_anterior IS NOT DISTINCT FROM $3
        AND precio_nuevo IS NOT DISTINCT FROM $4 AND fecha=$5
    `, [r.sku, r.campo, r.precio_anterior, r.precio_nuevo, r.fecha]);
    if (existe.rowCount) continue;
    await newDb.query(`
      INSERT INTO price_history (sku, campo, precio_anterior, precio_nuevo, fecha, visto)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [r.sku, r.campo, r.precio_anterior, r.precio_nuevo, r.fecha, r.visto]);
    n++;
  }
  return n;
}

async function migrarStock(oldDb, newDb) {
  const { rows } = await oldDb.query('SELECT sku, stock, store_name, updated_at FROM stock_cache');
  let n = 0;
  for (const r of rows) {
    await newDb.query(`
      INSERT INTO stock_cache (sku, stock, store_name, updated_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT (sku) DO UPDATE SET stock=EXCLUDED.stock, store_name=EXCLUDED.store_name, updated_at=EXCLUDED.updated_at
    `, [r.sku, r.stock, r.store_name, r.updated_at]);
    n++;
  }
  return n;
}

async function migrarTodo(oldDb, newDb) {
  const { rows } = await oldDb.query('SELECT sku, size, quantity, created_at FROM todo_items');
  let n = 0;
  for (const r of rows) {
    await newDb.query(`
      INSERT INTO todo_items (sku, size, quantity, created_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT (sku) DO UPDATE SET size=EXCLUDED.size, quantity=EXCLUDED.quantity
    `, [r.sku, r.size, r.quantity, r.created_at]);
    n++;
  }
  return n;
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
