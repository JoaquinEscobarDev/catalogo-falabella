const db = require('../config/database');

async function create({ tienda, p1, p2, p3, p4, p5 }) {
  const { rows } = await db.query(
    `INSERT INTO encuestas_electronica (tienda, p1, p2, p3, p4, p5)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tienda, p1, p2, p3, p4, p5]
  );
  return rows[0];
}

async function findAll(tienda) {
  if (tienda) {
    const { rows } = await db.query(
      'SELECT * FROM encuestas_electronica WHERE tienda=$1 ORDER BY created_at DESC',
      [tienda]
    );
    return rows;
  }
  const { rows } = await db.query('SELECT * FROM encuestas_electronica ORDER BY created_at DESC');
  return rows;
}

async function countByTienda() {
  const { rows } = await db.query(
    'SELECT tienda, COUNT(*)::int AS total FROM encuestas_electronica GROUP BY tienda ORDER BY tienda'
  );
  return rows;
}

module.exports = { create, findAll, countByTienda };
