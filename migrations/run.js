// Aplica los archivos .sql de esta carpeta en orden, una sola vez cada uno.
// Uso: node migrations/run.js  (necesita DATABASE_URL en el entorno)

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = __dirname;

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const archivos = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const { rows: aplicadas } = await db.query('SELECT filename FROM schema_migrations');
  const yaAplicadas = new Set(aplicadas.map(r => r.filename));

  for (const archivo of archivos) {
    if (yaAplicadas.has(archivo)) {
      console.log(`  = ${archivo} (ya aplicada)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, archivo), 'utf8');
    console.log(`  → aplicando ${archivo}...`);
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [archivo]);
      await db.query('COMMIT');
      console.log(`  ✓ ${archivo}`);
    } catch (e) {
      await db.query('ROLLBACK');
      throw new Error(`Falló ${archivo}: ${e.message}`);
    }
  }

  console.log('Migraciones al día.');
  await db.end();
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
