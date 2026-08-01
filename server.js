const env = require('./src/config/env');
const db = require('./src/config/database');
const app = require('./src/app');

// Falla rápido si Postgres no está disponible en vez de levantar el server
// y recién explotar en el primer request. El esquema lo crea migrations/run.js,
// no el arranque de la app.
db.query('SELECT 1')
  .then(() => {
    app.listen(env.port, () => console.log(`Servidor corriendo en http://localhost:${env.port}`));
  })
  .catch(e => {
    console.error('Error conectando a Postgres:', e.message);
    process.exit(1);
  });
