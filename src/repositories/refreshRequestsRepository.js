const db = require('../config/database');

async function create(categoryId) {
  const { rows } = await db.query(
    'INSERT INTO refresh_requests (category_id) VALUES ($1) RETURNING id',
    [categoryId]
  );
  return rows[0].id;
}

// procesado = el worker ya la tomó; terminado_en = terminó de refrescar.
async function getStatus(id) {
  const { rows } = await db.query(
    'SELECT procesado, terminado_en, ok, fail FROM refresh_requests WHERE id = $1', [id]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { tomada: r.procesado, terminada: r.terminado_en != null, ok: r.ok, fail: r.fail };
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

async function markFinished(id, ok, fail) {
  await db.query(
    'UPDATE refresh_requests SET procesado = TRUE, terminado_en = NOW(), ok = $2, fail = $3 WHERE id = $1',
    [id, ok, fail]
  );
}

// Solicitudes tomadas por un proceso que murió antes de terminar (redeploy,
// reinicio): se cierran para que la web no se quede esperándolas.
// (Solo las viejas: una recién tomada puede estar en manos del otro worker.)
async function closeOrphans() {
  await db.query(`
    UPDATE refresh_requests SET terminado_en = NOW()
    WHERE procesado = TRUE AND terminado_en IS NULL AND creado_en < NOW() - INTERVAL '45 minutes'
  `);
}

module.exports = { create, getStatus, findPending, markProcessed, markFinished, closeOrphans };
