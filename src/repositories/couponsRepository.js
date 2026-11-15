const db = require('../config/database');

function mapRow(r) {
  return {
    id: r.id, codigo: r.codigo, tipo: r.tipo, valor: r.valor,
    tope: r.tope, minimo: r.minimo, soloCMR: r.solo_cmr,
    alcance: r.alcance, alcanceValor: r.alcance_valor,
    // DATE llega como objeto Date en hora local del server: se devuelve AAAA-MM-DD.
    vence: r.vence_txt || null,
    vencido: r.vencido === true,
    origen: r.origen || 'manual',
    texto: r.texto || null,
    detectadoEn: r.detectado_en || null,
  };
}

// Los automáticos que no se vieron en la página en los últimos 3 días ya no
// cuentan: Falabella los sacó, aunque no dijeran fecha de vencimiento.
const AUTOMATICO_FRESCO = `(origen <> 'automatico' OR detectado_en > NOW() - INTERVAL '3 days')`;

const SELECT = `
  SELECT *, to_char(vence, 'YYYY-MM-DD') AS vence_txt,
         (vence IS NOT NULL AND vence < (NOW() AT TIME ZONE 'America/Santiago')::date) AS vencido
  FROM coupons`;

async function findAll() {
  const { rows } = await db.query(`${SELECT}
    WHERE ${AUTOMATICO_FRESCO}
      AND (vence IS NULL OR vence >= (NOW() AT TIME ZONE 'America/Santiago')::date)
    ORDER BY origen DESC, created_at DESC`);
  return rows.map(mapRow);
}

// Los cupones vencidos (manuales o automáticos) se borran solos, y también
// los automáticos que hace más de 3 días que no aparecen en la página.
async function eliminarNoVigentes() {
  await db.query(`
    DELETE FROM coupons
    WHERE (vence IS NOT NULL AND vence < (NOW() AT TIME ZONE 'America/Santiago')::date)
       OR (origen = 'automatico' AND (detectado_en IS NULL OR detectado_en < NOW() - INTERVAL '3 days'))
  `);
}

async function findVigentes() {
  const { rows } = await db.query(`${SELECT}
    WHERE (vence IS NULL OR vence >= (NOW() AT TIME ZONE 'America/Santiago')::date)
      AND ${AUTOMATICO_FRESCO}
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

// Reemplaza todos los cupones automáticos por los recién encontrados, de una
// sola vez: nunca queda la lista a medias. Los manuales no se tocan.
async function reemplazarAutomaticos(cupones) {
  await db.transaccion(async q => {
    await q(`DELETE FROM coupons WHERE origen = 'automatico'`);
    for (const c of cupones) {
      await q(`
        INSERT INTO coupons (codigo, tipo, valor, tope, minimo, solo_cmr, alcance, alcance_valor, vence, origen, texto, detectado_en)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'automatico',$10,NOW())
      `, [c.codigo, c.tipo, c.valor, c.tope, c.minimo, !!c.soloCMR, c.alcance, c.alcanceValor, c.vence, c.texto]);
    }
  });
}

async function remove(id) {
  await db.query('DELETE FROM coupons WHERE id = $1', [id]);
}

module.exports = { findAll, findVigentes, insert, reemplazarAutomaticos, eliminarNoVigentes, remove };
