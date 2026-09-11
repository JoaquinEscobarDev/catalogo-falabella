const db = require('../config/database');

async function create({ nombre, apellido, telefono, modelo, almacenamiento, color }) {
  const { rows } = await db.query(
    `INSERT INTO reservas_iphone (nombre, apellido, telefono, modelo, almacenamiento, color)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [nombre, apellido, telefono, modelo, almacenamiento, color]
  );
  return rows[0];
}

async function findAll() {
  const { rows } = await db.query(
    'SELECT * FROM reservas_iphone ORDER BY created_at DESC'
  );
  return rows;
}

module.exports = { create, findAll };
