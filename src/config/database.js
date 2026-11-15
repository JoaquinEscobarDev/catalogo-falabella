const { Pool } = require('pg');
const env = require('./env');

// No lanzar en tiempo de carga: si DATABASE_URL falta, el Pool falla en la
// primera query y el retry de server.js lo captura con un mensaje claro.
if (!env.databaseUrl) {
  console.error('ADVERTENCIA: DATABASE_URL no está definida. Verificar las variables de entorno.');
}

// Los tiempos límite importan sobre todo en el worker remoto (un teléfono):
// la red se corta y vuelve, y sin ellos una consulta sobre una conexión
// muerta queda colgada para siempre y frena todo el refresh.
const pool = new Pool(env.databaseUrl ? {
  connectionString: env.databaseUrl,
  connectionTimeoutMillis: 15000,
  // Conexiones ociosas se cierran pronto: mejor abrir una nueva que reusar
  // una que la red ya cortó sin avisar.
  idleTimeoutMillis: 20000,
  query_timeout: 30000,
  keepAlive: true,
} : {});

// Una conexión ociosa que se cae emite 'error' en el pool; sin este listener
// eso tumba el proceso. El pool ya la descarta solo.
pool.on('error', () => {});

const ERRORES_DE_CONEXION = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|Connection terminated|timeout exceeded when trying to connect|Query read timeout/i;

function esErrorDeConexion(e) {
  return !!e && ERRORES_DE_CONEXION.test(`${e.code || ''} ${e.message || ''}`);
}

async function query(...args) {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL no definida — configurar en las variables de entorno');
  }
  try {
    return await pool.query(...args);
  } catch (e) {
    // Un corte de red momentáneo: se reintenta una vez con una conexión nueva.
    if (!esErrorDeConexion(e)) throw e;
    await new Promise(r => setTimeout(r, 1500));
    return pool.query(...args);
  }
}

// Varias consultas como una sola: o se aplican todas o ninguna.
async function transaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn((...args) => client.query(...args));
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  query,
  transaccion,
  esErrorDeConexion,
  end: () => pool.end(),
};
