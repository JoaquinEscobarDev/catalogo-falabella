const db = require('../config/database');

async function create(categoryId) {
  const { rows } = await db.query(
    'INSERT INTO refresh_requests (category_id) VALUES ($1) RETURNING id',
    [categoryId]
  );
  return rows[0].id;
}

async function getStatus(id) {
  const { rows } = await db.query('SELECT procesado FROM refresh_requests WHERE id = $1', [id]);
  return rows.length ? rows[0].procesado : null;
}

async function findPending() {
  const { rows } = await db.query(`
    SELECT r.id, c.nombre AS categoria
    FROM refresh_requests r
    JOIN categories c ON c.id = r.category_id
    WHERE r.procesado = FALSE
    ORDER BY r.creado_en ASC
  `);
  return rows;
}

async function markProcessed(id) {
  await db.query('UPDATE refresh_requests SET procesado = TRUE WHERE id = $1', [id]);
}

module.exports = { create, getStatus, findPending, markProcessed };
