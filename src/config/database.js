const { Pool } = require('pg');
const env = require('./env');

if (!env.databaseUrl) {
  throw new Error('Falta DATABASE_URL — la app requiere Postgres, ya no hay fallback a JSON local');
}

const pool = new Pool({ connectionString: env.databaseUrl });

module.exports = pool;
