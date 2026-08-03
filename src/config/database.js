const { Pool } = require('pg');
const env = require('./env');

// No lanzar en tiempo de carga: si DATABASE_URL falta, el Pool falla en la
// primera query y el retry de server.js lo captura con un mensaje claro.
if (!env.databaseUrl) {
  console.error('ADVERTENCIA: DATABASE_URL no está definida. Verificar variables de entorno en Railway.');
}

const pool = new Pool(env.databaseUrl ? { connectionString: env.databaseUrl } : {});

// Proxy para dar un error claro si alguien llama query() sin DATABASE_URL.
module.exports = {
  query: (...args) => {
    if (!env.databaseUrl) {
      return Promise.reject(new Error('DATABASE_URL no definida — configurar en Railway > Variables'));
    }
    return pool.query(...args);
  },
};
