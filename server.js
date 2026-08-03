const env = require('./src/config/env');
const db = require('./src/config/database');
const app = require('./src/app');

process.on('uncaughtException',  e => console.error('UncaughtException:', e));
process.on('unhandledRejection', e => console.error('UnhandledRejection:', e));

// Railway arranca Node y Postgres casi en simultáneo; Postgres puede tardar
// unos segundos más. Reintentamos con backoff antes de rendirse.
async function conectarDB(intentosMax = 10, delayMs = 2000) {
  for (let i = 1; i <= intentosMax; i++) {
    try {
      await db.query('SELECT 1');
      return; // conexión exitosa
    } catch (e) {
      console.error(`DB no disponible (intento ${i}/${intentosMax}): ${e.message}`);
      if (i === intentosMax) {
        console.error('No se pudo conectar a Postgres. Abortando.');
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

conectarDB().then(() => {
  app.listen(env.port, () => console.log(`Servidor corriendo en http://localhost:${env.port}`));
});
