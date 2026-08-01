const db = require('../config/database');

// El frontend manda categoria como texto libre (lista fija en public/app.js,
// no hay administración de categorías) — se resuelve/crea el id on-the-fly.
async function findOrCreateIdByName(nombre) {
  const nombreFinal = nombre || 'Sin categoría';
  const existente = await db.query('SELECT id FROM categories WHERE nombre = $1', [nombreFinal]);
  if (existente.rowCount) return existente.rows[0].id;

  const creado = await db.query(
    'INSERT INTO categories (nombre) VALUES ($1) ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id',
    [nombreFinal]
  );
  return creado.rows[0].id;
}

async function findIdByName(nombre) {
  const r = await db.query('SELECT id FROM categories WHERE nombre = $1', [nombre]);
  return r.rowCount ? r.rows[0].id : null;
}

module.exports = { findOrCreateIdByName, findIdByName };
