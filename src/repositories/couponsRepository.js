const db = require('../config/database');

function mapRow(r) {
  return {
    id: r.id, codigo: r.codigo, tipo: r.tipo, valor: r.valor,
    tope: r.tope, minimo: r.minimo, soloCMR: r.solo_cmr,
    alcance: r.alcance, alcanceValor: r.alcance_valor,
    // DATE llega como objeto Date en hora local del server: se devuelve AAAA-MM-DD.
    vence: r.vence_txt || null,
    vencido: r.vencido === true,
  };
}

const SELECT = `
  SELECT *, to_char(vence, 'YYYY-MM-DD') AS vence_txt,
         (vence IS NOT NULL AND vence < (NOW() AT TIME ZONE 'America/Santiago')::date) AS vencido
  FROM coupons`;

async function findAll() {
  const { rows } = await db.query(`${SELECT} ORDER BY created_at DESC`);
  return rows.map(mapRow);
}

async function findVigentes() {
  const { rows } = await db.query(`${SELECT}
    WHERE vence IS NULL OR vence >= (NOW() AT TIME ZONE 'America/Santiago')::date
    ORDER BY created_at DESC`);
  return rows.map(mapRow);
}

async function insert(c) {
  const { rows } = await db.query(`
    INSERT INTO coupons (codigo, tipo, valor, tope, minimo, solo_cmr, alcance, alcance_valor, vence)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
  `, [c.codigo, c.tipo, c.valor, c.tope, c.minimo, c.soloCMR, c.alcance, c.alcanceValor, c.vence]);
  return rows[0].id;
}

async function remove(id) {
  await db.query('DELETE FROM coupons WHERE id = $1', [id]);
}

module.exports = { findAll, findVigentes, insert, remove };
