const db = require('../config/database');

async function recordChanges(sku, anterior, nuevo) {
  const campos = [
    ['normal', anterior?.precio_normal, nuevo.precio],
    ['oferta', anterior?.precio_oferta, nuevo.precioOferta],
    ['cmr', anterior?.precio_cmr, nuevo.precioCMR],
  ];
  for (const [campo, antes, despues] of campos) {
    // Solo registrar si ya había un precio previo y cambió (evita ruido en el primer fetch)
    if (antes != null && despues != null && antes !== despues) {
      await db.query(
        'INSERT INTO price_history (sku, campo, precio_anterior, precio_nuevo) VALUES ($1,$2,$3,$4)',
        [sku, campo, antes, despues]
      );
    }
  }
}

async function findUnseenSkus() {
  const { rows } = await db.query('SELECT DISTINCT sku FROM price_history WHERE visto = FALSE');
  return rows.map(r => r.sku);
}

async function findUnseenBySku() {
  const { rows } = await db.query(`
    SELECT id, sku, campo, precio_anterior, precio_nuevo, fecha
    FROM price_history WHERE visto = FALSE ORDER BY fecha ASC
  `);
  const porSku = {};
  for (const c of rows) (porSku[c.sku] ||= []).push(c);
  return porSku;
}

async function markSeenBySku(sku) {
  await db.query('UPDATE price_history SET visto = TRUE WHERE sku = $1', [sku]);
}

async function markAllSeen() {
  await db.query('UPDATE price_history SET visto = TRUE WHERE visto = FALSE');
}

module.exports = { recordChanges, findUnseenSkus, findUnseenBySku, markSeenBySku, markAllSeen };
