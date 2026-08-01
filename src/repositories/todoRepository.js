const db = require('../config/database');

async function ensureExists(sku) {
  await db.query('INSERT INTO todo_items (sku) VALUES ($1) ON CONFLICT (sku) DO NOTHING', [sku]);
}

async function findAll() {
  const { rows } = await db.query('SELECT sku, size, quantity FROM todo_items ORDER BY created_at ASC');
  return rows;
}

async function upsert(sku, size, quantity) {
  await db.query(`
    INSERT INTO todo_items (sku, size, quantity) VALUES ($1, $2, $3)
    ON CONFLICT (sku) DO UPDATE SET size = EXCLUDED.size, quantity = EXCLUDED.quantity
  `, [sku, size || 'Mediano', quantity || 1]);
}

async function remove(sku) {
  await db.query('DELETE FROM todo_items WHERE sku = $1', [sku]);
}

async function clear() {
  await db.query('DELETE FROM todo_items');
}

module.exports = { ensureExists, findAll, upsert, remove, clear };
