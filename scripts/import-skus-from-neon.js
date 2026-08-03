// Importa solo la lista de SKUs + categorías desde Neon al nuevo Railway Postgres.
// Uso: node scripts/import-skus-from-neon.js
// Requiere OLD_DATABASE_URL (Neon) y DATABASE_URL (Railway) en .env o entorno.

require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
  const oldUrl = process.env.OLD_DATABASE_URL || process.env.OLD_DB;
  const newUrl = process.env.DATABASE_URL;
  if (!oldUrl || !newUrl) throw new Error('Falta OLD_DATABASE_URL o DATABASE_URL');

  const oldDb = new Client({ connectionString: oldUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  const newDb = new Client({ connectionString: newUrl, connectionTimeoutMillis: 15000 });

  console.log('Conectando a Neon...');
  await oldDb.connect();
  console.log('Conectando a Railway...');
  await newDb.connect();

  // Categorías
  const { rows: cats } = await oldDb.query(`SELECT DISTINCT COALESCE(categoria, 'Sin categoría') AS categoria FROM skus`);
  for (const { categoria } of cats) {
    await newDb.query('INSERT INTO categories (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [categoria]);
  }
  console.log(`${cats.length} categorías insertadas`);

  // SKUs
  const { rows: skus } = await oldDb.query(`SELECT sku, alias, COALESCE(categoria, 'Sin categoría') AS categoria FROM skus ORDER BY sku`);
  const { rows: catRows } = await newDb.query('SELECT id, nombre FROM categories');
  const catMap = new Map(catRows.map(r => [r.nombre, r.id]));

  let n = 0;
  for (const { sku, alias, categoria } of skus) {
    const categoryId = catMap.get(categoria);
    await newDb.query(
      'INSERT INTO products (sku, alias, category_id) VALUES ($1,$2,$3) ON CONFLICT (sku) DO NOTHING',
      [sku, alias, categoryId]
    );
    n++;
  }
  console.log(`${n} SKUs insertados`);

  await oldDb.end();
  await newDb.end();
  console.log('Listo. Corré ahora: node scripts/refresh-local.js');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
