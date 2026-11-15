const db = require('../config/database');

// Un worker remoto se considera vivo si dio señal en los últimos 3 minutos.
const VENTANA_LATIDO = "3 minutes";

async function latido(detalle) {
  await db.query(`
    INSERT INTO worker_state (clave, valor, actualizado_en) VALUES ('latido:remoto', $1, NOW())
    ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()
  `, [detalle || null]);
}

async function remoto() {
  const { rows } = await db.query(`
    SELECT valor, actualizado_en, actualizado_en > NOW() - INTERVAL '${VENTANA_LATIDO}' AS activo
    FROM worker_state WHERE clave = 'latido:remoto'
  `);
  if (!rows.length) return { activo: false, ultimoLatido: null, detalle: null };
  return { activo: rows[0].activo, ultimoLatido: rows[0].actualizado_en, detalle: rows[0].valor };
}

// "Actualizar todo ahora": queda anotado en la base para que lo tome el
// worker que esté a cargo (servidor o remoto). Devuelve false si ya estaba pedido.
async function pedirTotal() {
  const r = await db.query(`
    INSERT INTO worker_state (clave, valor) VALUES ('total_pedido', '1') ON CONFLICT (clave) DO NOTHING
  `);
  return r.rowCount > 0;
}

async function tomarTotal() {
  const r = await db.query(`DELETE FROM worker_state WHERE clave = 'total_pedido'`);
  return r.rowCount > 0;
}

async function totalPendiente() {
  const r = await db.query(`SELECT 1 FROM worker_state WHERE clave = 'total_pedido'`);
  return r.rowCount > 0;
}

// Valores sueltos (por ejemplo el resumen de la última búsqueda de cupones).
async function guardar(clave, valor) {
  await db.query(`
    INSERT INTO worker_state (clave, valor, actualizado_en) VALUES ($1, $2, NOW())
    ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()
  `, [clave, valor]);
}

async function leer(clave) {
  const { rows } = await db.query('SELECT valor FROM worker_state WHERE clave = $1', [clave]);
  return rows.length ? rows[0].valor : null;
}

module.exports = { latido, remoto, pedirTotal, tomarTotal, totalPendiente, guardar, leer };
