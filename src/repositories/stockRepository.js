const db = require('../config/database');

async function get(sku) {
  const r = await db.query('SELECT * FROM stock_cache WHERE sku = $1', [sku]);
  return r.rowCount ? r.rows[0] : null;
}

async function set(sku, stock, storeName) {
  await db.query(`
    INSERT INTO stock_cache (sku, stock, store_name, updated_at)
    VALUES ($1,$2,$3,NOW())
    ON CONFLICT (sku) DO UPDATE SET stock=EXCLUDED.stock, store_name=EXCLUDED.store_name, updated_at=NOW()
  `, [sku, stock, storeName]);
}

module.exports = { get, set };
