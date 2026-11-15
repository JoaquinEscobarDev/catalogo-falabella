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

// ── Equipos con plan (colección Falabella Connect) ──

// Reemplaza todas las ofertas por las recién leídas, de una sola vez.
async function reemplazarOfertas(ofertas) {
  await db.transaccion(async q => {
    await q('DELETE FROM connect_ofertas');
    for (const o of ofertas) {
      for (const id of o.ids) {
        await q(`
          INSERT INTO connect_ofertas (id_falabella, nombre, marca, precio_con_plan, tipo_precio, precio_sin_plan, url, plan)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (id_falabella) DO UPDATE SET
            precio_con_plan = LEAST(connect_ofertas.precio_con_plan, EXCLUDED.precio_con_plan)
        `, [id, o.nombre, o.marca, o.precioConPlan, o.tipoPrecio, o.precioSinPlan, o.url, o.plan ? JSON.stringify(o.plan) : null]);
      }
    }
  });
}

// Una fila por equipo (agrupando sus ids), indicando si está en el catálogo.
async function ofertasResumen() {
  const { rows } = await db.query(`
    SELECT o.nombre, MIN(o.marca) AS marca, MIN(o.precio_con_plan) AS precio_con_plan,
           MIN(o.tipo_precio) AS tipo_precio, MIN(o.precio_sin_plan) AS precio_sin_plan,
           MIN(o.url) AS url, bool_or(p.sku IS NOT NULL) AS en_catalogo,
           MIN(p.sku) AS sku_catalogo
    FROM connect_ofertas o
    LEFT JOIN products p ON p.sku = o.id_falabella
    WHERE o.detectado_en > NOW() - INTERVAL '3 days'
    GROUP BY o.nombre
    ORDER BY bool_or(p.sku IS NOT NULL) DESC, MIN(o.precio_con_plan)
  `);
  return rows.map(r => ({
    nombre: r.nombre, marca: r.marca, precioConPlan: r.precio_con_plan, tipoPrecio: r.tipo_precio,
    precioSinPlan: r.precio_sin_plan, url: r.url, enCatalogo: r.en_catalogo, skuCatalogo: r.sku_catalogo,
  }));
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
  planesManuales, insertPlan, removePlan, equiposConPlan, reemplazarOfertas, ofertasResumen,
  ventasDelMes, insertVenta, removeVenta,
};
