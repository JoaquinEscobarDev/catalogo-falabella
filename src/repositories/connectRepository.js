const db = require('../config/database');

// ── Planes ──

function mapPlan(r) {
  return {
    id: r.id, compania: r.compania, nombre: r.nombre, tipo: r.tipo, mensual: r.mensual,
    gigas: r.gigas, minutos: r.minutos, notas: r.notas,
  };
}

async function planesManuales() {
  const { rows } = await db.query('SELECT * FROM connect_planes ORDER BY compania, mensual');
  return rows.map(mapPlan);
}

async function insertPlan(p) {
  const { rows } = await db.query(`
    INSERT INTO connect_planes (compania, nombre, tipo, mensual, gigas, minutos, notas)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
  `, [p.compania, p.nombre, p.tipo, p.mensual, p.gigas, p.minutos, p.notas]);
  return rows[0].id;
}

async function removePlan(id) {
  await db.query('DELETE FROM connect_planes WHERE id = $1', [id]);
}

// Equipos con plan detectado en su ficha, actualizados en los últimos 3 días
// (si la ficha deja de mostrar el plan, el refresh lo borra).
async function equiposConPlan() {
  const { rows } = await db.query(`
    SELECT p.sku, p.nombre, p.marca, p.plan, p.precio_normal, p.precio_oferta, p.precio_cmr, p.imagen
    FROM products p
    WHERE p.plan IS NOT NULL AND p.price_updated_at > NOW() - INTERVAL '3 days'
    ORDER BY p.nombre
  `);
  return rows;
}

// ── Ventas ──

function mapVenta(r) {
  return {
    id: r.id, fecha: r.fecha, tipo: r.tipo, compania: r.compania, plan: r.plan, mensual: r.mensual,
    sku: r.sku, equipo: r.equipo, precioEquipo: r.precio_equipo,
    cliente: r.cliente, telefono: r.telefono, vendedor: r.vendedor, notas: r.notas,
  };
}

// mes: 'AAAA-MM', en hora de Chile.
async function ventasDelMes(mes) {
  const { rows } = await db.query(`
    SELECT * FROM connect_ventas
    WHERE to_char(fecha AT TIME ZONE 'America/Santiago', 'YYYY-MM') = $1
    ORDER BY fecha DESC
  `, [mes]);
  return rows.map(mapVenta);
}

async function insertVenta(v) {
  const { rows } = await db.query(`
    INSERT INTO connect_ventas (tipo, compania, plan, mensual, sku, equipo, precio_equipo, cliente, telefono, vendedor, notas)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
  `, [v.tipo, v.compania, v.plan, v.mensual, v.sku, v.equipo, v.precioEquipo, v.cliente, v.telefono, v.vendedor, v.notas]);
  return rows[0].id;
}

async function removeVenta(id) {
  await db.query('DELETE FROM connect_ventas WHERE id = $1', [id]);
}

module.exports = {
  planesManuales, insertPlan, removePlan, equiposConPlan,
  ventasDelMes, insertVenta, removeVenta,
};
