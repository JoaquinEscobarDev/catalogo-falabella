const db = require('../config/database');

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id, tipo: r.tipo, detalle: r.detalle,
    iniciadoEn: r.iniciado_en, terminadoEn: r.terminado_en,
    total: r.total, ok: r.ok, fail: r.fail, cambios: r.cambios, estado: r.estado,
    origen: r.origen,
  };
}

async function start(tipo, detalle, total, origen = 'servidor') {
  const { rows } = await db.query(
    'INSERT INTO refresh_runs (tipo, detalle, total, origen) VALUES ($1, $2, $3, $4) RETURNING id',
    [tipo, detalle || null, total, origen]
  );
  return rows[0].id;
}

async function progress(id, { ok, fail, cambios }) {
  await db.query('UPDATE refresh_runs SET ok = $2, fail = $3, cambios = $4 WHERE id = $1', [id, ok, fail, cambios]);
}

async function finish(id, { ok, fail, cambios, estado }) {
  await db.query(
    'UPDATE refresh_runs SET ok = $2, fail = $3, cambios = $4, estado = $5, terminado_en = NOW() WHERE id = $1',
    [id, ok, fail, cambios, estado]
  );
}

// Solo las corridas de este mismo origen: el servidor no debe cerrar una
// corrida que el teléfono tiene en curso, ni al revés.
async function closeOrphans(origen = 'servidor') {
  await db.query(
    `UPDATE refresh_runs SET estado = 'interrumpido', terminado_en = NOW() WHERE estado = 'en_curso' AND origen = $1`,
    [origen]
  );
}

async function findEnCurso() {
  const { rows } = await db.query(`SELECT * FROM refresh_runs WHERE estado = 'en_curso' ORDER BY iniciado_en DESC LIMIT 1`);
  return mapRow(rows[0]);
}

// Última corrida completa que "cuenta" para decidir si a `origen` le toca el
// refresh programado: una que salió bien (o está en curso) de cualquiera, o
// cualquier intento propio. Así un intento bloqueado del servidor no le quita
// el turno al teléfono, y cada uno no reintenta en loop sus propios fallos.
async function findLastFullQueCuenta(origen) {
  const { rows } = await db.query(`
    SELECT * FROM refresh_runs
    WHERE tipo IN ('diario', 'manual') AND (estado IN ('ok', 'en_curso') OR origen = $1)
    ORDER BY iniciado_en DESC LIMIT 1
  `, [origen]);
  return mapRow(rows[0]);
}

async function findLast() {
  const { rows } = await db.query(`SELECT * FROM refresh_runs WHERE estado <> 'en_curso' ORDER BY iniciado_en DESC LIMIT 1`);
  return mapRow(rows[0]);
}

// Último refresh completo (diario o "actualizar todo"), haya terminado como haya terminado.
async function findLastFull() {
  const { rows } = await db.query(`SELECT * FROM refresh_runs WHERE tipo IN ('diario', 'manual') ORDER BY iniciado_en DESC LIMIT 1`);
  return mapRow(rows[0]);
}

async function findRecent(limit = 10) {
  const { rows } = await db.query('SELECT * FROM refresh_runs ORDER BY iniciado_en DESC LIMIT $1', [limit]);
  return rows.map(mapRow);
}

module.exports = { start, progress, finish, closeOrphans, findEnCurso, findLast, findLastFull, findLastFullQueCuenta, findRecent };
